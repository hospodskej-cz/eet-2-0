using Xunit;

namespace EetGateway.Client.Tests;

/// <summary>Runs only when EET_URL is set.</summary>
public sealed class IntegrationFactAttribute : FactAttribute
{
    public IntegrationFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("EET_URL") is null) Skip = "set EET_URL to run against a gateway";
    }
}

/// <summary>
/// Against the real gateway over a fake EET (no network, no certificates):
/// <code>
/// bun scripts/examples-server.ts 8080 &amp;
/// EET_URL=http://localhost:8080 EET_API_KEY=examples-key-0123456789 dotnet test clients/dotnet
/// </code>
/// The first attempt of every sale "times out", the resend half a second later is accepted
/// (scripts/examples-server.ts), so this also walks the 202 -> polling path.
/// </summary>
public sealed class IntegrationTests : IDisposable
{
    private readonly EetGatewayClient _client = new(
        Environment.GetEnvironmentVariable("EET_URL") ?? "http://localhost:8080",
        Environment.GetEnvironmentVariable("EET_API_KEY") ?? "examples-key-0123456789",
        new EetGatewayClientOptions { Timeout = TimeSpan.FromSeconds(15) });

    public void Dispose() => _client.Dispose();

    private static SaleInput Sale(string receipt) => new()
    {
        PoradCis = receipt,
        DatTrzby = DateTimeOffset.Now,
        CelkTrzba = 123.5m,
    };

    private static string Unique(string prefix) => $"{prefix}-{DateTime.UtcNow.Ticks}";

    [IntegrationFact]
    public async Task Submit_wait_and_idempotent_replay()
    {
        var receipt = Unique("CS");
        var sale = Sale(receipt); // the same sale again, or the key counts as reused for another sale
        var first = await _client.SubmitSaleAsync(sale, new SubmitOptions { IdempotencyKey = receipt });
        Assert.NotNull(first.Id);
        Assert.Equal($"/v1/sales/{first.Id}", first.Location);
        Assert.True(first.IsPending); // fake EET: first attempt times out

        var done = await _client.WaitForSaleAsync(first, TimeSpan.FromSeconds(15), TimeSpan.FromMilliseconds(200));
        Assert.Equal(SaleStatus.Accepted, done.Status);
        Assert.False(string.IsNullOrEmpty(done.Pok));

        var again = await _client.SubmitSaleAsync(sale, new SubmitOptions { IdempotencyKey = receipt });
        Assert.Equal(first.Id, again.Id);
        Assert.True(again.Replayed);

        var attempts = await _client.GetSaleAttemptsAsync(first.Id!);
        Assert.Equal([true, false], attempts.Select(a => a.PrvniZaslani));
        Assert.Equal("accepted", attempts[^1].Outcome);

        var seen = false;
        await foreach (var queued in _client.ListQueueAllAsync(new QueueQuery { Limit = 5 }))
            if (queued.Id == first.Id) { seen = true; break; }
        Assert.True(seen);
    }

    [IntegrationFact]
    public async Task Verification_mode_and_invalid_sale()
    {
        var checkedSale = await _client.SubmitSaleAsync(Sale(Unique("V")), new SubmitOptions { Verify = true });
        checkedSale = await _client.WaitForSaleAsync(checkedSale, TimeSpan.FromSeconds(15), TimeSpan.FromMilliseconds(200));
        Assert.Equal(SaleStatus.VerificationOk, checkedSale.Status);
        Assert.True(checkedSale.IsSuccess);

        var invalid = await _client.SubmitSaleRawAsync("""{"porad_cis":"X"}""", "application/json");
        Assert.Equal(SaleStatus.Invalid, invalid.Status);
        Assert.NotEmpty(invalid.Issues);
        Assert.Null(invalid.Id);
    }

    [IntegrationFact]
    public async Task Batch_validate_and_system_endpoints()
    {
        var rows = new[] { Sale(Unique("B1")), Sale(Unique("B2")) };
        var verdict = await _client.ValidateSalesAsync(rows);
        Assert.True(verdict.IsValid);
        Assert.Equal(2, verdict.Rows.Count);

        var batch = await _client.SubmitBatchAsync(rows, new SubmitOptions { IdempotencyKey = Unique("batch") });
        Assert.Equal([1, 2], batch.Rows.Select(r => r.Row));
        Assert.All(batch.Rows, r => Assert.NotNull(r.Result.Id));

        Assert.True((await _client.HealthAsync()).IsOk);
        Assert.StartsWith("3.1", (await _client.GetOpenApiAsync()).GetProperty("openapi").GetString());
        Assert.Contains("<", await _client.GetDocsAsync());
        Assert.NotNull(await _client.ListRegistersAsync());
    }

    [IntegrationFact]
    public async Task Errors()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _client.GetSaleAsync("does-not-exist"));
        using var wrong = new EetGatewayClient(
            Environment.GetEnvironmentVariable("EET_URL")!, "wrong-key-0123456789");
        await Assert.ThrowsAsync<UnauthorizedException>(() => wrong.ListQueueAsync());
    }
}
