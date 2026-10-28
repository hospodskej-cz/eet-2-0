using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace EetGateway.Client.Tests;

public sealed record Recorded(string Method, string Path, Dictionary<string, string> Query, Dictionary<string, string> Headers, string Body)
{
    public JsonElement Json => JsonDocument.Parse(Body).RootElement;
}

/// <summary>A tiny in-process fake of the gateway: scripted answers, recorded requests.</summary>
public sealed class FakeGateway : IDisposable
{
    private sealed record Answer(int Status, byte[] Body, Dictionary<string, string> Headers, TimeSpan Delay);

    private readonly HttpListener _listener = new();
    private readonly Queue<Answer> _script = new();
    private Answer? _last;
    private readonly object _lock = new();

    public string Url { get; }
    public List<Recorded> Requests { get; } = [];
    public Recorded Last => Requests[^1];

    public FakeGateway()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        Url = $"http://127.0.0.1:{port}";
        _listener.Prefixes.Add(Url + "/");
        _listener.Start();
        _ = Task.Run(Loop);
    }

    /// <summary>Queues the answer to the next request; the last answer repeats once the queue is empty.</summary>
    public void Respond(int status, object? body = null, Dictionary<string, string>? headers = null, TimeSpan? delay = null)
    {
        headers ??= [];
        byte[] raw;
        if (body is string text) raw = Encoding.UTF8.GetBytes(text);
        else if (body is null) raw = [];
        else
        {
            raw = JsonSerializer.SerializeToUtf8Bytes(body);
            headers["Content-Type"] = "application/json";
        }
        lock (_lock) _script.Enqueue(new Answer(status, raw, headers, delay ?? TimeSpan.Zero));
    }

    private async Task Loop()
    {
        while (_listener.IsListening)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch (Exception) when (!_listener.IsListening)
            {
                return;
            }
            _ = Task.Run(() => Handle(context));
        }
    }

    private async Task Handle(HttpListenerContext context)
    {
        try
        {
            var request = context.Request;
            using var reader = new StreamReader(request.InputStream, Encoding.UTF8);
            var body = await reader.ReadToEndAsync().ConfigureAwait(false);
            var raw = request.RawUrl ?? "/";
            var queryAt = raw.IndexOf('?');
            var query = new Dictionary<string, string>();
            foreach (var key in request.QueryString.AllKeys)
                if (key is not null) query[key] = request.QueryString[key] ?? "";
            var headers = new Dictionary<string, string>();
            foreach (var key in request.Headers.AllKeys)
                if (key is not null) headers[key.ToLowerInvariant()] = request.Headers[key] ?? "";

            Answer answer;
            lock (_lock)
            {
                Requests.Add(new Recorded(request.HttpMethod, queryAt < 0 ? raw : raw[..queryAt], query, headers, body));
                if (_script.Count > 0) _last = _script.Dequeue();
                answer = _last ?? throw new InvalidOperationException("no answer queued: call Respond() first");
            }

            if (answer.Delay > TimeSpan.Zero) await Task.Delay(answer.Delay).ConfigureAwait(false);
            var response = context.Response;
            response.StatusCode = answer.Status;
            foreach (var (key, value) in answer.Headers)
            {
                if (key == "Content-Type") response.ContentType = value;
                else response.AddHeader(key, value);
            }
            response.ContentLength64 = answer.Body.Length;
            await response.OutputStream.WriteAsync(answer.Body).ConfigureAwait(false);
            response.Close();
        }
        catch (Exception)
        {
            // the client gave up (timeout test)
            try { context.Response.Abort(); } catch (Exception) { /* nothing to do */ }
        }
    }

    public void Dispose() => _listener.Close();
}
