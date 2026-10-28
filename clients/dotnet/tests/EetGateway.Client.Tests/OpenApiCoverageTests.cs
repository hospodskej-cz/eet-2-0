using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Xunit;

namespace EetGateway.Client.Tests;

/// <summary>
/// Drift guard: the client must cover everything docs/openapi.json describes. When the gateway gains
/// an operation, a query parameter, a header or a response field, one of these tests fails until the
/// client (and the table below) catches up. scripts/gen-clients.ts does the static half of the same
/// check for all three languages.
/// </summary>
public sealed class OpenApiCoverageTests : IDisposable
{
    private static readonly string[] HttpMethods = ["get", "post", "put", "patch", "delete", "head", "options"];

    private static readonly JsonElement Spec = LoadSpec();

    private static readonly SaleInput Sale = new() { DatTrzby = DateTimeOffset.UnixEpoch, CelkTrzba = 1m, PoradCis = "R-1" };
    private static readonly object EmptyBatch = new { rows = Array.Empty<object>(), warnings = Array.Empty<object>(), issues = Array.Empty<object>() };

    /// <summary>operationId to (client call using EVERY documented parameter, fake answer to give).</summary>
    private static readonly Dictionary<string, (Func<EetGatewayClient, Task> Call, int Status, object Body)> Calls = new()
    {
        ["submitSale"] = (c => c.SubmitSaleAsync(Sale, new SubmitOptions { IdempotencyKey = "k", Mode = SubmitMode.Sync, Verify = true, Register = "r" }),
            200, new { status = "accepted", warnings = Array.Empty<object>(), attempts = 1 }),
        ["submitBatch"] = (c => c.SubmitBatchAsync([Sale], new SubmitOptions { IdempotencyKey = "k", Mode = SubmitMode.Async, Verify = true, Register = "r" }),
            200, EmptyBatch),
        ["getSale"] = (c => c.GetSaleAsync("id-1"), 200, new { status = "queued", warnings = Array.Empty<object>(), attempts = 0 }),
        ["getSaleAttempts"] = (c => c.GetSaleAttemptsAsync("id-1"), 200, new { items = Array.Empty<object>() }),
        ["retrySale"] = (c => c.RetrySaleAsync("id-1"), 200, new { status = "accepted", warnings = Array.Empty<object>(), attempts = 2 }),
        ["listQueue"] = (c => c.ListQueueAsync(new QueueQuery
            {
                Status = [SaleStatus.Queued], Register = "r", From = DateTimeOffset.UnixEpoch, To = DateTimeOffset.UnixEpoch,
                Overdue = true, Limit = 5, Cursor = "c",
            }), 200, new { items = Array.Empty<object>() }),
        ["listRegisters"] = (c => c.ListRegistersAsync(), 200, new { items = Array.Empty<object>() }),
        ["validateSales"] = (c => c.ValidateSalesAsync([Sale], new ValidateOptions { Verify = true, Register = "r" }), 200, EmptyBatch),
        ["health"] = (c => c.HealthAsync(checkEet: true), 200, new { status = "ok", version = "0", database = "ok" }),
        ["openapi"] = (c => c.GetOpenApiAsync(), 200, new { }),
        ["docs"] = (c => c.GetDocsAsync(), 200, "<html></html>"),
    };

    private readonly FakeGateway _gateway = new();

    public void Dispose() => _gateway.Dispose();

    private static JsonElement LoadSpec()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var file = Path.Combine(dir.FullName, "docs", "openapi.json");
            if (File.Exists(file)) return JsonDocument.Parse(File.ReadAllText(file)).RootElement.Clone();
        }
        throw new FileNotFoundException("docs/openapi.json not found above " + AppContext.BaseDirectory);
    }

    private static Dictionary<string, (string Method, string Path, JsonElement Operation)> SpecOperations() =>
        Spec.GetProperty("paths").EnumerateObject()
            .SelectMany(p => p.Value.EnumerateObject()
                .Where(m => HttpMethods.Contains(m.Name))
                .Select(m => (Id: m.Value.GetProperty("operationId").GetString()!, Method: m.Name.ToUpperInvariant(), Path: p.Name, Operation: m.Value)))
            .ToDictionary(o => o.Id, o => (o.Method, o.Path, o.Operation));

    public static TheoryData<string> OperationIds()
    {
        var data = new TheoryData<string>();
        foreach (var id in SpecOperations().Keys.Order()) data.Add(id);
        return data;
    }

    [Fact]
    public void Every_openapi_operation_is_in_the_client_table()
    {
        var spec = SpecOperations().ToDictionary(o => o.Key, o => (o.Value.Method, o.Value.Path));
        Assert.Equal(spec.OrderBy(o => o.Key), Operations.All.OrderBy(o => o.Key).ToDictionary(o => o.Key, o => o.Value).OrderBy(o => o.Key));
    }

    [Fact]
    public void Every_openapi_operation_has_a_call_in_this_test()
    {
        Assert.Equal(SpecOperations().Keys.Order(), Calls.Keys.Order());
    }

    [Theory]
    [MemberData(nameof(OperationIds))]
    public async Task Operation_hits_the_documented_method_path_and_parameters(string operationId)
    {
        var (method, path, operation) = SpecOperations()[operationId];
        var (call, status, body) = Calls[operationId];
        _gateway.Respond(status, body);
        using var client = new EetGatewayClient(_gateway.Url, "key");
        await call(client);
        var request = _gateway.Last;

        Assert.Equal(method, request.Method);
        Assert.Matches("^" + Regex.Replace(path, @"\{[^}]+\}", "[^/]+") + "$", request.Path);

        var parameters = operation.TryGetProperty("parameters", out var list) ? list.EnumerateArray().ToList() : [];
        var query = parameters.Where(p => p.GetProperty("in").GetString() == "query").Select(p => p.GetProperty("name").GetString()!);
        var headers = parameters.Where(p => p.GetProperty("in").GetString() == "header").Select(p => p.GetProperty("name").GetString()!.ToLowerInvariant());
        Assert.Equal(query.Order(), request.Query.Keys.Order());
        Assert.All(headers, h => Assert.True(request.Headers.ContainsKey(h), $"header {h} not sent"));

        var secured = operation.TryGetProperty("security", out var security) && security.GetArrayLength() > 0;
        Assert.Equal(secured, request.Headers.ContainsKey("authorization"));

        if (operation.TryGetProperty("requestBody", out var requestBody))
        {
            var mediaTypes = requestBody.GetProperty("content").EnumerateObject().Select(c => c.Name).ToList();
            Assert.Contains(mediaTypes, m => request.Headers["content-type"].StartsWith(m, StringComparison.Ordinal));
        }
    }

    private static void CollectProperties(JsonElement node, HashSet<string> names)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var member in node.EnumerateObject())
                {
                    if (member.Name == "properties" && member.Value.ValueKind == JsonValueKind.Object)
                        foreach (var property in member.Value.EnumerateObject()) names.Add(property.Name);
                    CollectProperties(member.Value, names);
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in node.EnumerateArray()) CollectProperties(item, names);
                break;
        }
    }

    [Fact]
    public void Every_schema_property_is_read_by_the_models()
    {
        var schemaNames = new HashSet<string>();
        CollectProperties(Spec.GetProperty("components").GetProperty("schemas"), schemaNames);
        schemaNames.Remove("error"); // the error envelope is read by hand in EetGatewayClient.ToError

        var modelled = typeof(EetGatewayClient).Assembly.GetTypes()
            .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            .Select(p => p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name)
            .Where(n => n is not null)
            .ToHashSet();

        Assert.Empty(schemaNames.Where(n => !modelled.Contains(n)).Order());
    }

    [Fact]
    public void Sale_statuses_match_the_schema()
    {
        var declared = Spec.GetProperty("components").GetProperty("schemas").GetProperty("SaleResult")
            .GetProperty("properties").GetProperty("status").GetProperty("enum").EnumerateArray().Select(e => e.GetString()!).ToList();
        var known = Enum.GetValues<SaleStatus>().Where(s => s != SaleStatus.Unknown).Select(s => s.ToWire()).ToList();
        Assert.Equal(declared, known);
    }
}
