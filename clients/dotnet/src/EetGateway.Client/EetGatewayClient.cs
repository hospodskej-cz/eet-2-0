using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace EetGateway.Client;

/// <summary>Settings of <see cref="EetGatewayClient"/>.</summary>
public sealed record EetGatewayClientOptions
{
    /// <summary>
    /// Bounds every request (default 30 s). A synchronous submit waits for EET, up to the register's
    /// <c>timeoutMs</c> (10 s by default), so keep it above that.
    /// </summary>
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);

    public string UserAgent { get; init; } = "EetGateway.Client/" + EetGatewayClient.Version;
}

/// <summary>
/// Client for one EET Gateway (HTTP API v1). Thread-safe; create one and reuse it.
/// The client never retries on its own: repeat a submit yourself with the same
/// <see cref="SubmitOptions.IdempotencyKey"/>.
/// </summary>
/// <example>
/// <code>
/// using var client = new EetGatewayClient("http://localhost:8080", apiKey);
/// var result = await client.SubmitSaleAsync(
///     new SaleInput { PoradCis = "R-1001", DatTrzby = DateTimeOffset.Now, CelkTrzba = 123.50m },
///     new SubmitOptions { IdempotencyKey = "R-1001" });
/// if (result.IsPending) result = await client.WaitForSaleAsync(result);
/// </code>
/// </example>
public sealed partial class EetGatewayClient : IDisposable
{
    public const string Version = "0.1.1";

    private const string JsonType = "application/json";

    [GeneratedRegex(@"^[\x21-\x7e]{1,255}\z")]
    private static partial Regex IdempotencyKeyPattern();

    internal static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private readonly string _baseUrl;
    private readonly string? _apiKey;
    private readonly EetGatewayClientOptions _options;

    /// <param name="baseUrl">Gateway root, e.g. <c>http://localhost:8080</c> (a path prefix behind a proxy is kept).</param>
    /// <param name="apiKey">Bearer key; null only for a gateway started with <c>--dev</c>.</param>
    public EetGatewayClient(string baseUrl, string? apiKey = null, EetGatewayClientOptions? options = null)
        : this(
            new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = System.Threading.Timeout.InfiniteTimeSpan },
            baseUrl, apiKey, options, ownsHttp: true)
    {
    }

    /// <summary>Uses your <see cref="HttpClient"/> (IHttpClientFactory, proxies, handlers). Its <c>BaseAddress</c> is the gateway root.</summary>
    public EetGatewayClient(HttpClient httpClient, string? apiKey = null, EetGatewayClientOptions? options = null)
        : this(httpClient, httpClient.BaseAddress?.ToString()
                ?? throw new ArgumentException("HttpClient.BaseAddress must be the gateway URL", nameof(httpClient)),
            apiKey, options, ownsHttp: false)
    {
    }

    private EetGatewayClient(HttpClient http, string baseUrl, string? apiKey, EetGatewayClientOptions? options, bool ownsHttp)
    {
        if (!baseUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !baseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("baseUrl must start with http:// or https://", nameof(baseUrl));
        _http = http;
        _ownsHttp = ownsHttp;
        _baseUrl = baseUrl.TrimEnd('/');
        _apiKey = string.IsNullOrEmpty(apiKey) ? null : apiKey;
        _options = options ?? new EetGatewayClientOptions();
    }

    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }

    // --- sales ----------------------------------------------------------------------------

    /// <summary>
    /// POST /v1/sales: validates, stores and sends one sale. Returns the <see cref="SaleResult"/> for
    /// HTTP 200 (accepted, verification_ok, rejected), 202 (queued, uncertain: use
    /// <see cref="WaitForSaleAsync(SaleResult, TimeSpan?, TimeSpan?, CancellationToken)"/>) and 422
    /// (invalid: see <see cref="SaleResult.Issues"/>, nothing was sent).
    /// </summary>
    /// <exception cref="IdempotencyConflictException">The key belongs to another sale (409).</exception>
    public Task<SaleResult> SubmitSaleAsync(SaleInput sale, SubmitOptions? options = null, CancellationToken cancellationToken = default) =>
        SubmitSaleRawAsync(JsonSerializer.Serialize(sale, Json), JsonType, options, cancellationToken);

    /// <summary><see cref="SubmitSaleAsync"/> for a body you already serialized: XML (<c>&lt;Data&gt;</c>, <c>&lt;Trzba&gt;</c>), JSON, form.</summary>
    public async Task<SaleResult> SubmitSaleRawAsync(string body, string contentType, SubmitOptions? options = null, CancellationToken cancellationToken = default)
    {
        var response = await SendAsync("submitSale", null, SubmitQuery(options), Text(body, contentType), options?.IdempotencyKey, true, cancellationToken).ConfigureAwait(false);
        return ToSaleResult(response, 200, 202, 422);
    }

    /// <summary>
    /// POST /v1/sales/batch: resending after an outage or migration (default mode: async). Each row is
    /// stored and sent on its own and keyed <c>&lt;key&gt;:&lt;row&gt;</c>. HTTP 200 and 422 (the source
    /// could not be read: <see cref="BatchResult.Issues"/>) both return a <see cref="BatchResult"/>.
    /// </summary>
    public Task<BatchResult> SubmitBatchAsync(IEnumerable<SaleInput> sales, SubmitOptions? options = null, CancellationToken cancellationToken = default) =>
        SubmitBatchRawAsync(JsonSerializer.Serialize(sales, Json), JsonType, options, cancellationToken);

    /// <summary><see cref="SubmitBatchAsync"/> for NDJSON (<c>application/x-ndjson</c>), CSV (<c>text/csv</c>) or XML.</summary>
    public async Task<BatchResult> SubmitBatchRawAsync(string body, string contentType, SubmitOptions? options = null, CancellationToken cancellationToken = default)
    {
        var response = await SendAsync("submitBatch", null, SubmitQuery(options), Text(body, contentType), options?.IdempotencyKey, true, cancellationToken).ConfigureAwait(false);
        return Decode<BatchResult>(response, 200, 422);
    }

    /// <summary>GET /v1/sales/{id}: the current state.</summary>
    /// <exception cref="NotFoundException">No such record.</exception>
    public async Task<SaleResult> GetSaleAsync(string id, CancellationToken cancellationToken = default) =>
        Decode<SaleResult>(await SendAsync("getSale", Id(id), null, null, null, true, cancellationToken).ConfigureAwait(false), 200);

    /// <summary>GET /v1/sales/{id}/attempts: every message sent for the sale, oldest first.</summary>
    public async Task<IReadOnlyList<Attempt>> GetSaleAttemptsAsync(string id, CancellationToken cancellationToken = default) =>
        Decode<AttemptList>(await SendAsync("getSaleAttempts", Id(id), null, null, null, true, cancellationToken).ConfigureAwait(false), 200).Items;

    /// <summary>POST /v1/sales/{id}/retry: sends a queued, uncertain or rejected sale now.</summary>
    /// <exception cref="ConflictException">not_retryable, in_progress or unknown_register.</exception>
    public async Task<SaleResult> RetrySaleAsync(string id, CancellationToken cancellationToken = default) =>
        ToSaleResult(await SendAsync("retrySale", Id(id), null, null, null, true, cancellationToken).ConfigureAwait(false), 200, 202);

    /// <summary>
    /// Polls <see cref="GetSaleAsync"/> until the sale is neither queued nor uncertain. After
    /// <paramref name="timeout"/> (default 30 s) it returns the last state, so check
    /// <see cref="SaleResult.IsPending"/>: the gateway keeps resending in the background.
    /// </summary>
    public async Task<SaleResult> WaitForSaleAsync(SaleResult sale, TimeSpan? timeout = null, TimeSpan? interval = null, CancellationToken cancellationToken = default)
    {
        if (sale.IsFinal || sale.Id is null) return sale;
        return await PollAsync(sale.Id, sale, timeout, interval, cancellationToken).ConfigureAwait(false);
    }

    /// <summary><see cref="WaitForSaleAsync(SaleResult, TimeSpan?, TimeSpan?, CancellationToken)"/> for a record id.</summary>
    public async Task<SaleResult> WaitForSaleAsync(string id, TimeSpan? timeout = null, TimeSpan? interval = null, CancellationToken cancellationToken = default) =>
        await PollAsync(id, await GetSaleAsync(id, cancellationToken).ConfigureAwait(false), timeout, interval, cancellationToken).ConfigureAwait(false);

    private async Task<SaleResult> PollAsync(string id, SaleResult current, TimeSpan? timeout, TimeSpan? interval, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(30));
        var pause = interval ?? TimeSpan.FromSeconds(1);
        while (current.IsPending && DateTime.UtcNow < deadline)
        {
            await Task.Delay(pause, cancellationToken).ConfigureAwait(false);
            current = await GetSaleAsync(id, cancellationToken).ConfigureAwait(false);
        }
        return current;
    }

    // --- queue, registers, validation -----------------------------------------------------

    /// <summary>GET /v1/queue: one page, newest first.</summary>
    public async Task<QueuePage> ListQueueAsync(QueueQuery? query = null, CancellationToken cancellationToken = default)
    {
        var q = new List<KeyValuePair<string, string?>>();
        if (query is not null)
        {
            if (query.Status is { Count: > 0 }) q.Add(new("status", string.Join(',', query.Status.Select(s => s.ToWire()))));
            q.Add(new("register", query.Register));
            q.Add(new("from", query.From is { } from ? Moment(from) : null));
            q.Add(new("to", query.To is { } to ? Moment(to) : null));
            q.Add(new("overdue", Flag(query.Overdue)));
            q.Add(new("limit", query.Limit?.ToString(CultureInfo.InvariantCulture)));
            q.Add(new("cursor", query.Cursor));
        }
        return Decode<QueuePage>(await SendAsync("listQueue", null, q, null, null, true, cancellationToken).ConfigureAwait(false), 200);
    }

    /// <summary>Every sale matching <paramref name="query"/>, following <see cref="QueuePage.NextCursor"/> page by page.</summary>
    public async IAsyncEnumerable<SaleResult> ListQueueAllAsync(QueueQuery? query = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var page = query ?? new QueueQuery();
        while (true)
        {
            var result = await ListQueueAsync(page, cancellationToken).ConfigureAwait(false);
            foreach (var item in result.Items) yield return item;
            if (string.IsNullOrEmpty(result.NextCursor)) yield break;
            page = page with { Cursor = result.NextCursor };
        }
    }

    /// <summary>GET /v1/registers: registers with certificate validity (<c>DaysLeft</c>, <c>ExpiresSoon</c>).</summary>
    public async Task<IReadOnlyList<Register>> ListRegistersAsync(CancellationToken cancellationToken = default) =>
        Decode<RegisterList>(await SendAsync("listRegisters", null, null, null, null, true, cancellationToken).ConfigureAwait(false), 200).Items;

    /// <summary>POST /v1/validate: the same ingest as a submit, but nothing is stored or sent.</summary>
    public Task<ValidationBatch> ValidateSalesAsync(IEnumerable<SaleInput> sales, ValidateOptions? options = null, CancellationToken cancellationToken = default) =>
        ValidateSalesRawAsync(JsonSerializer.Serialize(sales, Json), JsonType, options, cancellationToken);

    /// <summary><see cref="ValidateSalesAsync"/> for NDJSON, CSV, XML or a single JSON object.</summary>
    public async Task<ValidationBatch> ValidateSalesRawAsync(string body, string contentType, ValidateOptions? options = null, CancellationToken cancellationToken = default)
    {
        var q = new List<KeyValuePair<string, string?>> { new("verify", Flag(options?.Verify)), new("register", options?.Register) };
        var response = await SendAsync("validateSales", null, q, Text(body, contentType), null, true, cancellationToken).ConfigureAwait(false);
        return Decode<ValidationBatch>(response, 200, 422);
    }

    // --- system ---------------------------------------------------------------------------

    /// <summary>
    /// GET /health (public). A degraded gateway (HTTP 503) is returned, not thrown.
    /// <paramref name="checkEet"/> also probes every EET endpoint (the gateway caches the probe for 60 s).
    /// </summary>
    public async Task<Health> HealthAsync(bool checkEet = false, CancellationToken cancellationToken = default)
    {
        var q = new List<KeyValuePair<string, string?>> { new("eet", checkEet ? "true" : null) };
        return Decode<Health>(await SendAsync("health", null, q, null, null, false, cancellationToken).ConfigureAwait(false), 200, 503);
    }

    /// <summary>GET /openapi.json (public): the OpenAPI 3.1 document of the running gateway.</summary>
    public async Task<JsonElement> GetOpenApiAsync(CancellationToken cancellationToken = default) =>
        Decode<JsonElement>(await SendAsync("openapi", null, null, null, null, false, cancellationToken).ConfigureAwait(false), 200);

    /// <summary>GET /docs (public): the interactive API reference as HTML.</summary>
    public async Task<string> GetDocsAsync(CancellationToken cancellationToken = default)
    {
        var response = await SendAsync("docs", null, null, null, null, false, cancellationToken).ConfigureAwait(false);
        return response.Status == HttpStatusCode.OK ? Encoding.UTF8.GetString(response.Body) : throw ToError(response);
    }

    // --- internals ------------------------------------------------------------------------

    private sealed record Response(HttpStatusCode Status, HttpResponseHeaders Headers, byte[] Body);

    private static StringContent Text(string body, string contentType) =>
        new(body, Encoding.UTF8, MediaTypeHeaderValue.Parse(contentType));

    private static IReadOnlyDictionary<string, string> Id(string id) => new Dictionary<string, string> { ["id"] = id };

    private static string? Flag(bool? value) => value is { } v ? (v ? "true" : "false") : null;

    private static string Moment(DateTimeOffset value) => value.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);

    private static List<KeyValuePair<string, string?>> SubmitQuery(SubmitOptions? options) =>
    [
        new("mode", options?.Mode is { } mode ? (mode == SubmitMode.Sync ? "sync" : "async") : null),
        new("verify", Flag(options?.Verify)),
        new("register", options?.Register),
    ];

    private async Task<Response> SendAsync(
        string operation,
        IReadOnlyDictionary<string, string>? path,
        List<KeyValuePair<string, string?>>? query,
        HttpContent? content,
        string? idempotencyKey,
        bool authorize,
        CancellationToken cancellationToken)
    {
        var (method, template) = Operations.All[operation];
        var url = _baseUrl + (path is null
            ? template
            : template.Replace("{id}", Uri.EscapeDataString(path["id"]), StringComparison.Ordinal));
        var pairs = (query ?? []).Where(p => p.Value is not null).ToList();
        if (pairs.Count > 0)
            url += "?" + string.Join('&', pairs.Select(p => $"{Uri.EscapeDataString(p.Key)}={Uri.EscapeDataString(p.Value!)}"));

        using var request = new HttpRequestMessage(new HttpMethod(method), url) { Content = content };
        request.Headers.Accept.ParseAdd(JsonType);
        request.Headers.UserAgent.ParseAdd(_options.UserAgent);
        if (authorize && _apiKey is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
        if (idempotencyKey is not null)
        {
            if (!IdempotencyKeyPattern().IsMatch(idempotencyKey))
                throw new ArgumentException("IdempotencyKey must be 1-255 printable ASCII characters", nameof(idempotencyKey));
            request.Headers.Add("Idempotency-Key", idempotencyKey);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_options.Timeout);
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeout.Token).ConfigureAwait(false);
            var body = await response.Content.ReadAsByteArrayAsync(timeout.Token).ConfigureAwait(false);
            return new Response(response.StatusCode, response.Headers, body);
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            throw new RequestTimeoutException($"{method} {url} timed out after {_options.Timeout.TotalSeconds:0.###} s", ex);
        }
        catch (HttpRequestException ex)
        {
            throw new TransportException($"{method} {url} failed: {ex.Message}", ex);
        }
    }

    private static T Decode<T>(Response response, params int[] accept)
    {
        if (!accept.Contains((int)response.Status)) throw ToError(response);
        try
        {
            return JsonSerializer.Deserialize<T>(response.Body, Json)
                ?? throw new InvalidResponseException($"HTTP {(int)response.Status}: empty body", response.Status);
        }
        catch (JsonException ex)
        {
            throw new InvalidResponseException($"HTTP {(int)response.Status}: the body is not the documented JSON", response.Status, ex);
        }
    }

    private static SaleResult ToSaleResult(Response response, params int[] accept)
    {
        JsonElement? body = null;
        try
        {
            if (response.Body.Length > 0) body = JsonSerializer.Deserialize<JsonElement>(response.Body, Json);
        }
        catch (JsonException)
        {
            // handled below as an unexpected answer
        }
        var isSale = body is { ValueKind: JsonValueKind.Object } b && b.TryGetProperty("status", out _);
        if (response.Status == HttpStatusCode.Conflict && isSale)
            throw new IdempotencyConflictException(body!.Value.Deserialize<SaleResult>(Json)!);
        if (!accept.Contains((int)response.Status) || !isSale) throw ToError(response);

        var result = body!.Value.Deserialize<SaleResult>(Json)
            ?? throw new InvalidResponseException($"HTTP {(int)response.Status}: empty body", response.Status);
        return result with
        {
            Location = response.Headers.Location?.OriginalString,
            Replayed = response.Headers.TryGetValues("Idempotent-Replayed", out var values)
                && values.Any(v => v.Equals("true", StringComparison.OrdinalIgnoreCase)),
        };
    }

    private static ApiException ToError(Response response)
    {
        string code = "http_error", message = $"unexpected HTTP {(int)response.Status}";
        var text = Encoding.UTF8.GetString(response.Body).Trim();
        try
        {
            using var doc = JsonDocument.Parse(response.Body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                if (root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object)
                {
                    code = error.TryGetProperty("code", out var c) ? c.ToString() : code;
                    message = error.TryGetProperty("message", out var m) ? m.ToString() : message;
                }
                else if (root.TryGetProperty("issues", out var issues) && issues.ValueKind == JsonValueKind.Array && issues.GetArrayLength() > 0)
                {
                    var first = issues[0];
                    code = first.TryGetProperty("code", out var c) ? c.ToString() : code;
                    message = first.TryGetProperty("message", out var m) ? m.ToString() : message;
                }
            }
        }
        catch (JsonException)
        {
            if (text.Length > 0) message = text.Length > 200 ? text[..200] : text;
        }

        return (int)response.Status switch
        {
            400 => new BadRequestException(code, message),
            401 => new UnauthorizedException(code, message),
            404 => new NotFoundException(code, message),
            409 => new ConflictException(code, message),
            413 => new PayloadTooLargeException(code, message),
            415 => new UnsupportedMediaTypeException(code, message),
            422 => new UnprocessableException(code, message),
            >= 500 => new ServerException(response.Status, code, message),
            _ => new ApiException(response.Status, code, message),
        };
    }
}

/// <summary>
/// Every operation of docs/openapi.json: operationId to (HTTP method, path). The client sends its
/// requests through this table, and scripts/gen-clients.ts fails CI when it falls behind the
/// OpenAPI document.
/// </summary>
public static class Operations
{
    public static readonly IReadOnlyDictionary<string, (string Method, string Path)> All =
        new Dictionary<string, (string Method, string Path)>
        {
            ["submitSale"] = ("POST", "/v1/sales"),
            ["submitBatch"] = ("POST", "/v1/sales/batch"),
            ["getSale"] = ("GET", "/v1/sales/{id}"),
            ["getSaleAttempts"] = ("GET", "/v1/sales/{id}/attempts"),
            ["retrySale"] = ("POST", "/v1/sales/{id}/retry"),
            ["listQueue"] = ("GET", "/v1/queue"),
            ["listRegisters"] = ("GET", "/v1/registers"),
            ["validateSales"] = ("POST", "/v1/validate"),
            ["health"] = ("GET", "/health"),
            ["openapi"] = ("GET", "/openapi.json"),
            ["docs"] = ("GET", "/docs"),
        };
}
