using System.Net;
using System.Text.Json;
using Xunit;

namespace EetGateway.Client.Tests;

public sealed class ClientTests : IDisposable
{
    private const string Key = "secret-key-0123456789";

    private static readonly SaleInput Sale = new()
    {
        PoradCis = "R-1",
        DatTrzby = new DateTimeOffset(2027, 1, 5, 12, 0, 0, TimeSpan.FromHours(1)),
        CelkTrzba = 123.5m,
    };

    private readonly FakeGateway _gateway = new();
    private readonly EetGatewayClient _client;

    public ClientTests()
    {
        _client = new EetGatewayClient(_gateway.Url, Key, new EetGatewayClientOptions { Timeout = TimeSpan.FromSeconds(5) });
    }

    public void Dispose()
    {
        _client.Dispose();
        _gateway.Dispose();
    }

    private static object SaleBody(string status = "accepted", string id = "sale-1", object? extra = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["status"] = status,
            ["warnings"] = Array.Empty<object>(),
            ["attempts"] = 1,
        };
        if (status == "accepted") body["pok"] = "A1B2-C3";
        if (extra is not null)
            foreach (var property in extra.GetType().GetProperties())
                body[property.Name] = property.GetValue(extra);
        return body;
    }

    // --- SubmitSale: 200 / 202 / 422 / 409 -------------------------------------------------

    [Fact]
    public async Task SubmitSale_accepted()
    {
        _gateway.Respond(200, SaleBody(), new() { ["Location"] = "/v1/sales/sale-1" });
        var result = await _client.SubmitSaleAsync(Sale, new SubmitOptions { IdempotencyKey = "R-1" });

        Assert.Equal(SaleStatus.Accepted, result.Status);
        Assert.Equal("A1B2-C3", result.Pok);
        Assert.True(result.IsSuccess);
        Assert.True(result.IsFinal);
        Assert.False(result.IsPending);
        Assert.Equal("/v1/sales/sale-1", result.Location);
        Assert.False(result.Replayed);

        var request = _gateway.Last;
        Assert.Equal(("POST", "/v1/sales"), (request.Method, request.Path));
        Assert.Equal($"Bearer {Key}", request.Headers["authorization"]);
        Assert.Equal("R-1", request.Headers["idempotency-key"]);
        Assert.StartsWith("application/json", request.Headers["content-type"]);
        Assert.StartsWith("EetGateway.Client/", request.Headers["user-agent"]);
        Assert.Empty(request.Query);
        var json = request.Json;
        Assert.Equal("R-1", json.GetProperty("porad_cis").GetString());
        Assert.Equal("2027-01-05T12:00:00+01:00", json.GetProperty("dat_trzby").GetString());
        Assert.Equal("123.50", json.GetProperty("celk_trzba").GetString());
        Assert.False(json.TryGetProperty("eic_popl", out _));
    }

    [Fact]
    public async Task SubmitSale_query_options()
    {
        _gateway.Respond(200, SaleBody("verification_ok"));
        var result = await _client.SubmitSaleAsync(Sale, new SubmitOptions { Mode = SubmitMode.Async, Verify = true, Register = "kasa-1" });

        Assert.Equal(SaleStatus.VerificationOk, result.Status);
        Assert.True(result.IsSuccess);
        Assert.Equal(new Dictionary<string, string> { ["mode"] = "async", ["verify"] = "true", ["register"] = "kasa-1" }, _gateway.Last.Query);
        Assert.False(_gateway.Last.Headers.ContainsKey("idempotency-key"));
    }

    [Fact]
    public async Task SubmitSale_rejected_is_a_result_not_an_error()
    {
        _gateway.Respond(200, SaleBody("rejected", extra: new { code = 4, message = "Neplatný podpis" }));
        var result = await _client.SubmitSaleAsync(Sale);

        Assert.Equal(SaleStatus.Rejected, result.Status);
        Assert.Equal(4, result.Code);
        Assert.Equal("Neplatný podpis", result.Message);
        Assert.False(result.IsSuccess);
        Assert.True(result.IsFinal);
    }

    [Theory]
    [InlineData("queued")]
    [InlineData("uncertain")]
    public async Task SubmitSale_202_is_pending(string status)
    {
        _gateway.Respond(202, SaleBody(status, extra: new { reason = "timeout", nextAttemptAt = "2027-01-05T11:00:05Z" }),
            new() { ["Location"] = "/v1/sales/sale-1", ["Idempotent-Replayed"] = "true" });
        var result = await _client.SubmitSaleAsync(Sale);

        Assert.True(result.IsPending);
        Assert.False(result.IsFinal);
        Assert.False(result.IsSuccess);
        Assert.Equal("timeout", result.Reason);
        Assert.Equal("2027-01-05T11:00:05Z", result.NextAttemptAt);
        Assert.True(result.Replayed);
    }

    [Fact]
    public async Task SubmitSale_422_invalid_returns_issues()
    {
        _gateway.Respond(422, new
        {
            status = "invalid",
            warnings = new[] { new { code = 101, message = "shifted", source = "ingest", field = "dat_trzby" } },
            attempts = 0,
            issues = new[] { new { code = "missing_field", message = "celk_trzba chybí", field = "celk_trzba" } },
        });
        var result = await _client.SubmitSaleAsync(Sale);

        Assert.Equal(SaleStatus.Invalid, result.Status);
        Assert.Null(result.Id);
        Assert.Equal("missing_field", result.Issues[0].Code);
        Assert.Equal("celk_trzba", result.Issues[0].Field);
        Assert.Equal("ingest", result.Warnings[0].Source);
        Assert.Equal("dat_trzby", result.Warnings[0].Field);
    }

    [Fact]
    public async Task SubmitSale_409_idempotency_conflict()
    {
        _gateway.Respond(409, new
        {
            status = "invalid",
            warnings = Array.Empty<object>(),
            attempts = 0,
            issues = new[] { new { code = "idempotency_conflict", message = "key used for another sale" } },
        });
        var ex = await Assert.ThrowsAsync<IdempotencyConflictException>(
            () => _client.SubmitSaleAsync(Sale, new SubmitOptions { IdempotencyKey = "R-1" }));

        Assert.IsAssignableFrom<ConflictException>(ex);
        Assert.IsAssignableFrom<ApiException>(ex);
        Assert.Equal(HttpStatusCode.Conflict, ex.Status);
        Assert.Equal("idempotency_conflict", ex.Code);
        Assert.Equal("idempotency_conflict", ex.Result.Issues[0].Code);
    }

    [Fact]
    public async Task SubmitSale_422_single_sale_expected_is_an_error()
    {
        _gateway.Respond(422, new { error = new { code = "single_sale_expected", message = "one sale only" } });
        var ex = await Assert.ThrowsAsync<UnprocessableException>(() => _client.SubmitSaleAsync(Sale));
        Assert.Equal("single_sale_expected", ex.Code);
    }

    [Fact]
    public async Task SubmitSale_extra_fields_and_optional_amounts()
    {
        _gateway.Respond(200, SaleBody());
        await _client.SubmitSaleAsync(Sale with
        {
            CerpZuct = 12.5m,
            IdJednotky = "11",
            Extra = new() { ["currency"] = "CZK" },
        });
        var json = _gateway.Last.Json;
        Assert.Equal("CZK", json.GetProperty("currency").GetString());
        Assert.Equal("12.50", json.GetProperty("cerp_zuct").GetString());
        Assert.Equal("11", json.GetProperty("id_jednotky").GetString());
        Assert.False(json.TryGetProperty("urceno_cerp_zuct", out _));
    }

    [Fact]
    public async Task SubmitSaleRaw_xml()
    {
        _gateway.Respond(200, SaleBody());
        await _client.SubmitSaleRawAsync("<Data celk_trzba='1.00'/>", "application/xml", new SubmitOptions { IdempotencyKey = "x" });
        Assert.StartsWith("application/xml", _gateway.Last.Headers["content-type"]);
        Assert.Equal("<Data celk_trzba='1.00'/>", _gateway.Last.Body);
    }

    [Theory]
    [InlineData("")]
    [InlineData("line\nbreak")]
    [InlineData("abc\n")]
    [InlineData("žluťoučký")]
    public async Task Invalid_idempotency_key_is_rejected_before_sending(string key)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _client.SubmitSaleAsync(Sale, new SubmitOptions { IdempotencyKey = key }));
        await Assert.ThrowsAsync<ArgumentException>(() => _client.SubmitSaleAsync(Sale, new SubmitOptions { IdempotencyKey = new string('a', 256) }));
        Assert.Empty(_gateway.Requests);
    }

    // --- parsed models ---------------------------------------------------------------------

    [Fact]
    public async Task SaleResult_full_model_ignores_unknown_fields()
    {
        _gateway.Respond(200, SaleBody(extra: new
        {
            register = "kasa-1",
            uuid = "u-1",
            test = true,
            overdue = false,
            createdAt = "2027-01-05T11:00:00Z",
            deadlineAt = "2027-01-07T11:00:00Z",
            httpStatus = 200,
            globalTransactionId = "g-1",
            data = new
            {
                eic_popl = "CZ00000019",
                id_jednotky = "11",
                id_pokl = "KASA-1",
                porad_cis = "R-1",
                dat_trzby = "2027-01-05T12:00:00+01:00",
                celk_trzba = "123.50",
            },
            warnings = new[] { new { code = 5, message = "m", source = "eet" } },
            futureField = "ignored",
        }));
        var result = await _client.GetSaleAsync("sale-1");

        Assert.Equal("123.50", result.Data!.CelkTrzba);
        Assert.Equal("CZ00000019", result.Data.EicPopl);
        Assert.Equal(("kasa-1", "u-1", true), (result.Register, result.Uuid, result.Test));
        Assert.Equal("g-1", result.GlobalTransactionId);
        Assert.Equal(200, result.HttpStatus);
        Assert.False(result.Overdue);
        Assert.Equal("eet", result.Warnings[0].Source);
    }

    [Fact]
    public async Task Unknown_status_reads_as_Unknown()
    {
        _gateway.Respond(200, SaleBody("brand_new"));
        var result = await _client.GetSaleAsync("sale-1");
        Assert.Equal(SaleStatus.Unknown, result.Status);
        Assert.False(result.IsSuccess);
        Assert.True(result.IsFinal);
    }

    // --- other operations ------------------------------------------------------------------

    [Fact]
    public async Task SubmitBatch()
    {
        _gateway.Respond(200, new
        {
            rows = new object[]
            {
                new { row = 1, result = SaleBody("queued") },
                new { row = 2, result = new { status = "invalid", warnings = Array.Empty<object>(), attempts = 0, issues = new[] { new { code = "c", message = "m" } } } },
            },
            warnings = Array.Empty<object>(),
            issues = Array.Empty<object>(),
        });
        var result = await _client.SubmitBatchAsync([Sale, Sale], new SubmitOptions { IdempotencyKey = "batch-1", Mode = SubmitMode.Sync });

        Assert.Equal([1, 2], result.Rows.Select(r => r.Row));
        Assert.True(result.Rows[0].Result.IsPending);
        Assert.Equal(SaleStatus.Invalid, result.Rows[1].Result.Status);
        Assert.Equal(("POST", "/v1/sales/batch"), (_gateway.Last.Method, _gateway.Last.Path));
        Assert.Equal(2, _gateway.Last.Json.GetArrayLength());
        Assert.Equal("batch-1", _gateway.Last.Headers["idempotency-key"]);
        Assert.Equal(new Dictionary<string, string> { ["mode"] = "sync" }, _gateway.Last.Query);
    }

    [Fact]
    public async Task SubmitBatch_unreadable_source_422()
    {
        _gateway.Respond(422, new { rows = Array.Empty<object>(), warnings = Array.Empty<object>(), issues = new[] { new { code = "bad_json", message = "not JSON" } } });
        var result = await _client.SubmitBatchRawAsync("{{", "application/json");
        Assert.Empty(result.Rows);
        Assert.Equal("bad_json", result.Issues[0].Code);
    }

    [Fact]
    public async Task SubmitBatchRaw_csv()
    {
        _gateway.Respond(200, new { rows = Array.Empty<object>(), warnings = Array.Empty<object>(), issues = Array.Empty<object>() });
        await _client.SubmitBatchRawAsync("dat_trzby;celk_trzba\n2027-01-05;1,00\n", "text/csv");
        Assert.StartsWith("text/csv", _gateway.Last.Headers["content-type"]);
    }

    [Fact]
    public async Task GetSale_path_is_escaped()
    {
        _gateway.Respond(200, SaleBody());
        await _client.GetSaleAsync("a/b c");
        Assert.Equal("/v1/sales/a%2Fb%20c", _gateway.Last.Path);
    }

    [Fact]
    public async Task GetSaleAttempts()
    {
        _gateway.Respond(200, new
        {
            items = new object[]
            {
                new { n = 1, uuid_zpravy = "u-1", dat_odesl = "2027-01-05T12:00:01+01:00", prvni_zaslani = true, overeni = false, environment = "playground", endpoint = "https://pg.example/eet", startedAt = "2027-01-05T11:00:01Z", outcome = "uncertain", reason = "timeout", durationMs = 10000 },
                new { n = 2, uuid_zpravy = "u-2", dat_odesl = "2027-01-05T12:00:20+01:00", prvni_zaslani = false, overeni = false, environment = "playground", endpoint = "https://pg.example/eet", startedAt = "2027-01-05T11:00:20Z", finishedAt = "2027-01-05T11:00:21Z", outcome = "accepted", pok = "A1B2-C3", httpStatus = 200 },
            },
        });
        var attempts = await _client.GetSaleAttemptsAsync("sale-1");

        Assert.Equal("/v1/sales/sale-1/attempts", _gateway.Last.Path);
        Assert.Equal([1, 2], attempts.Select(a => a.N));
        Assert.Null(attempts[0].FinishedAt);
        Assert.Equal(10000, attempts[0].DurationMs);
        Assert.Equal("accepted", attempts[1].Outcome);
        Assert.Equal("A1B2-C3", attempts[1].Pok);
        Assert.False(attempts[1].PrvniZaslani);
    }

    [Fact]
    public async Task RetrySale()
    {
        _gateway.Respond(202, SaleBody("queued"));
        var result = await _client.RetrySaleAsync("sale-1");
        Assert.Equal(("POST", "/v1/sales/sale-1/retry"), (_gateway.Last.Method, _gateway.Last.Path));
        Assert.True(result.IsPending);
    }

    [Fact]
    public async Task RetrySale_not_retryable()
    {
        _gateway.Respond(409, new { error = new { code = "not_retryable", message = "final" } });
        var ex = await Assert.ThrowsAsync<ConflictException>(() => _client.RetrySaleAsync("sale-1"));
        Assert.IsNotType<IdempotencyConflictException>(ex);
        Assert.Equal("not_retryable", ex.Code);
    }

    [Fact]
    public async Task ListQueue_filters()
    {
        _gateway.Respond(200, new { items = new[] { SaleBody("queued") }, nextCursor = "c2" });
        var page = await _client.ListQueueAsync(new QueueQuery
        {
            Status = [SaleStatus.Queued, SaleStatus.Uncertain],
            Register = "kasa-1",
            From = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero),
            To = new DateTimeOffset(2027, 2, 1, 1, 0, 0, TimeSpan.FromHours(1)),
            Overdue = false,
            Limit = 20,
            Cursor = "c1",
        });

        Assert.Equal("c2", page.NextCursor);
        Assert.True(page.Items[0].IsPending);
        Assert.Equal(new Dictionary<string, string>
        {
            ["status"] = "queued,uncertain",
            ["register"] = "kasa-1",
            ["from"] = "2027-01-01T00:00:00+00:00",
            ["to"] = "2027-02-01T01:00:00+01:00",
            ["overdue"] = "false",
            ["limit"] = "20",
            ["cursor"] = "c1",
        }, _gateway.Last.Query);
    }

    [Fact]
    public async Task ListQueue_without_filters_sends_no_query()
    {
        _gateway.Respond(200, new { items = Array.Empty<object>() });
        await _client.ListQueueAsync();
        Assert.Empty(_gateway.Last.Query);
    }

    [Fact]
    public async Task ListQueueAll_follows_cursors()
    {
        _gateway.Respond(200, new { items = new[] { SaleBody(id: "a"), SaleBody(id: "b") }, nextCursor = "p2" });
        _gateway.Respond(200, new { items = new[] { SaleBody(id: "c") } });
        var ids = new List<string?>();
        await foreach (var sale in _client.ListQueueAllAsync(new QueueQuery { Limit = 2 })) ids.Add(sale.Id);

        Assert.Equal(["a", "b", "c"], ids);
        Assert.False(_gateway.Requests[0].Query.ContainsKey("cursor"));
        Assert.Equal("p2", _gateway.Requests[1].Query["cursor"]);
        Assert.Equal("2", _gateway.Requests[1].Query["limit"]);
    }

    [Fact]
    public async Task ListRegisters()
    {
        _gateway.Respond(200, new
        {
            items = new[]
            {
                new
                {
                    id = "kasa-1",
                    environment = "playground",
                    endpoint = "https://pg.example/eet",
                    defaults = new { eic_popl = "CZ00000019", id_jednotky = "11" },
                    timeZone = "Europe/Prague",
                    certificates = new[]
                    {
                        new
                        {
                            eic = "CZ00000019", subject = "CN=x", issuer = "CN=I.CA", serialNumber = "01", fingerprintSha256 = "ab",
                            notBefore = "2026-01-01T00:00:00Z", notAfter = "2027-01-20T00:00:00Z",
                            daysLeft = 15, active = true, expiresSoon = true, expired = false,
                        },
                    },
                },
            },
        });
        var register = Assert.Single(await _client.ListRegistersAsync());

        Assert.Equal("kasa-1", register.Id);
        Assert.Equal("Europe/Prague", register.TimeZone);
        Assert.Equal("11", register.Defaults["id_jednotky"]);
        var cert = Assert.Single(register.Certificates);
        Assert.Equal((15, true, true, false), (cert.DaysLeft, cert.ExpiresSoon, cert.Active, cert.Expired));
        Assert.Equal("ab", cert.FingerprintSha256);
        Assert.Equal("01", cert.SerialNumber);
    }

    [Fact]
    public async Task ValidateSales()
    {
        _gateway.Respond(200, new
        {
            rows = new object[]
            {
                new { row = 1, result = new { valid = true, warnings = Array.Empty<object>(), issues = Array.Empty<object>(), overeni = false } },
                new { row = 2, result = new { valid = false, warnings = Array.Empty<object>(), issues = new[] { new { code = "missing_field", message = "m", field = "celk_trzba" } } } },
            },
            warnings = Array.Empty<object>(),
            issues = Array.Empty<object>(),
        });
        var batch = await _client.ValidateSalesAsync([Sale, Sale], new ValidateOptions { Verify = true, Register = "kasa-1" });

        Assert.Equal(("POST", "/v1/validate"), (_gateway.Last.Method, _gateway.Last.Path));
        Assert.Equal(new Dictionary<string, string> { ["verify"] = "true", ["register"] = "kasa-1" }, _gateway.Last.Query);
        Assert.True(batch.Rows[0].Result.Valid);
        Assert.False(batch.Rows[1].Result.Valid);
        Assert.False(batch.IsValid);
        Assert.Equal("celk_trzba", batch.Rows[1].Result.Issues[0].Field);
    }

    [Fact]
    public async Task ValidateSalesRaw_unreadable_422()
    {
        _gateway.Respond(422, new { rows = Array.Empty<object>(), warnings = Array.Empty<object>(), issues = new[] { new { code = "bad_csv", message = "m" } } });
        var batch = await _client.ValidateSalesRawAsync("ÿ", "text/csv");
        Assert.Equal("bad_csv", batch.Issues[0].Code);
        Assert.False(batch.IsValid);
    }

    [Fact]
    public async Task Health_is_public_and_503_is_returned()
    {
        _gateway.Respond(503, new
        {
            status = "degraded",
            version = "0.1.0",
            database = "ok",
            eet = new[] { new { endpoint = "https://e", reachable = false, durationMs = 12.5, checkedAt = "t", error = "dns" } },
        });
        var health = await _client.HealthAsync(checkEet: true);

        Assert.False(health.IsOk);
        Assert.Equal("ok", health.Database);
        Assert.Equal("dns", health.Eet![0].Error);
        Assert.False(health.Eet[0].Reachable);
        Assert.Equal(12.5, health.Eet[0].DurationMs);
        Assert.Equal("/health", _gateway.Last.Path);
        Assert.Equal(new Dictionary<string, string> { ["eet"] = "true" }, _gateway.Last.Query);
        Assert.False(_gateway.Last.Headers.ContainsKey("authorization"));
    }

    [Fact]
    public async Task GetOpenApi_and_docs()
    {
        _gateway.Respond(200, new { openapi = "3.1.0" });
        Assert.Equal("3.1.0", (await _client.GetOpenApiAsync()).GetProperty("openapi").GetString());
        Assert.Equal("/openapi.json", _gateway.Last.Path);
        Assert.False(_gateway.Last.Headers.ContainsKey("authorization"));
        _gateway.Respond(200, "<html>docs</html>");
        Assert.Equal("<html>docs</html>", await _client.GetDocsAsync());
        Assert.Equal("/docs", _gateway.Last.Path);
    }

    // --- WaitForSale -----------------------------------------------------------------------

    [Fact]
    public async Task WaitForSale_polls_until_final()
    {
        _gateway.Respond(200, SaleBody("uncertain"));
        _gateway.Respond(200, SaleBody("queued"));
        _gateway.Respond(200, SaleBody("accepted"));
        var result = await _client.WaitForSaleAsync("sale-1", interval: TimeSpan.FromMilliseconds(10));

        Assert.Equal(SaleStatus.Accepted, result.Status);
        Assert.Equal(3, _gateway.Requests.Count);
        Assert.All(_gateway.Requests, r => Assert.Equal("/v1/sales/sale-1", r.Path));
    }

    [Fact]
    public async Task WaitForSale_skips_a_final_result()
    {
        _gateway.Respond(200, SaleBody("accepted"));
        var final = await _client.GetSaleAsync("sale-1");
        Assert.Same(final, await _client.WaitForSaleAsync(final));
        Assert.Single(_gateway.Requests);
    }

    [Fact]
    public async Task WaitForSale_gives_up_with_the_last_state()
    {
        _gateway.Respond(202, SaleBody("queued"));
        _gateway.Respond(200, SaleBody("queued"));
        var pending = await _client.SubmitSaleAsync(Sale);
        var result = await _client.WaitForSaleAsync(pending, TimeSpan.FromMilliseconds(80), TimeSpan.FromMilliseconds(10));
        Assert.True(result.IsPending);
    }

    // --- errors ----------------------------------------------------------------------------

    [Theory]
    [InlineData(400, "bad_request", typeof(BadRequestException))]
    [InlineData(401, "unauthorized", typeof(UnauthorizedException))]
    [InlineData(404, "not_found", typeof(NotFoundException))]
    [InlineData(413, "payload_too_large", typeof(PayloadTooLargeException))]
    [InlineData(415, "unsupported_media_type", typeof(UnsupportedMediaTypeException))]
    [InlineData(500, "internal", typeof(ServerException))]
    public async Task Error_statuses_map_to_exceptions(int status, string code, Type expected)
    {
        _gateway.Respond(status, new { error = new { code, message = "boom" } });
        var ex = await Assert.ThrowsAnyAsync<ApiException>(() => _client.GetSaleAsync("x"));

        Assert.IsType(expected, ex);
        Assert.Equal(status, (int)ex.Status);
        Assert.Equal(code, ex.Code);
        Assert.Equal("boom", ex.ErrorMessage);
    }

    [Fact]
    public async Task Non_json_error_body()
    {
        _gateway.Respond(502, "<html>Bad Gateway</html>");
        var ex = await Assert.ThrowsAsync<ServerException>(() => _client.GetSaleAsync("x"));
        Assert.Equal(HttpStatusCode.BadGateway, ex.Status);
        Assert.Contains("Bad Gateway", ex.ErrorMessage);
    }

    [Fact]
    public async Task Success_with_non_json_body()
    {
        _gateway.Respond(200, "not json");
        await Assert.ThrowsAsync<InvalidResponseException>(() => _client.GetSaleAsync("x"));
    }

    [Fact]
    public async Task Redirects_are_not_followed()
    {
        _gateway.Respond(301, "", new() { ["Location"] = "http://elsewhere.invalid/" });
        var ex = await Assert.ThrowsAsync<ApiException>(() => _client.SubmitSaleAsync(Sale));
        Assert.Equal(HttpStatusCode.MovedPermanently, ex.Status);
        Assert.Single(_gateway.Requests);
    }

    [Fact]
    public async Task Timeout()
    {
        _gateway.Respond(200, SaleBody(), delay: TimeSpan.FromSeconds(2));
        using var slow = new EetGatewayClient(_gateway.Url, "k", new EetGatewayClientOptions { Timeout = TimeSpan.FromMilliseconds(200) });
        var ex = await Assert.ThrowsAsync<RequestTimeoutException>(() => slow.GetSaleAsync("x"));
        Assert.IsAssignableFrom<TransportException>(ex);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_a_timeout()
    {
        _gateway.Respond(200, SaleBody(), delay: TimeSpan.FromSeconds(2));
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _client.GetSaleAsync("x", cts.Token));
    }

    [Fact]
    public async Task Connection_refused()
    {
        string closed;
        using (var dead = new FakeGateway()) closed = dead.Url;
        using var unreachable = new EetGatewayClient(closed, "k", new EetGatewayClientOptions { Timeout = TimeSpan.FromSeconds(10) });
        await Assert.ThrowsAsync<TransportException>(() => unreachable.HealthAsync());
    }

    [Fact]
    public async Task Base_url_validation_and_path_prefix()
    {
        Assert.Throws<ArgumentException>(() => new EetGatewayClient("localhost:8080"));
        _gateway.Respond(200, SaleBody());
        using var prefixed = new EetGatewayClient(_gateway.Url + "/", "k");
        await prefixed.GetSaleAsync("a");
        Assert.Equal("/v1/sales/a", _gateway.Last.Path);
    }

    [Fact]
    public async Task Uses_a_supplied_HttpClient_without_disposing_it()
    {
        _gateway.Respond(200, new { items = Array.Empty<object>() });
        using var http = new HttpClient { BaseAddress = new Uri(_gateway.Url) };
        var client = new EetGatewayClient(http, Key);
        await client.ListRegistersAsync();
        client.Dispose();
        Assert.Equal($"Bearer {Key}", _gateway.Last.Headers["authorization"]);
        _gateway.Respond(200, new { items = Array.Empty<object>() });
        await http.GetAsync("/still-usable");
    }

    [Fact]
    public async Task No_api_key_sends_no_authorization()
    {
        _gateway.Respond(200, new { items = Array.Empty<object>() });
        using var open = new EetGatewayClient(_gateway.Url);
        await open.ListRegistersAsync();
        Assert.False(_gateway.Last.Headers.ContainsKey("authorization"));
    }

    [Fact]
    public async Task Request_body_is_utf8_json()
    {
        _gateway.Respond(200, SaleBody());
        await _client.SubmitSaleAsync(Sale with { Extra = new() { ["note"] = "Čaj" } });
        Assert.Equal("Čaj", JsonDocument.Parse(_gateway.Last.Body).RootElement.GetProperty("note").GetString());
    }

    [Fact]
    public void SaleStatus_wire_names_round_trip()
    {
        foreach (var status in Enum.GetValues<SaleStatus>().Where(s => s != SaleStatus.Unknown))
            Assert.Equal(status, SaleStatusNames.Parse(status.ToWire()));
        Assert.Equal("verification_ok", SaleStatus.VerificationOk.ToWire());
        Assert.Throws<ArgumentOutOfRangeException>(() => SaleStatus.Unknown.ToWire());
    }
}
