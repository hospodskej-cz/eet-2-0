// Sends one sale to the EET Gateway HTTP API and waits for EET's answer.
// .NET 8, no NuGet packages:
//   EET_URL=http://localhost:8080 EET_API_KEY=… dotnet run --project examples/csharp/EetExample
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

var url = Environment.GetEnvironmentVariable("EET_URL") ?? "http://localhost:8080";
var key = Environment.GetEnvironmentVariable("EET_API_KEY")
    ?? throw new InvalidOperationException("set EET_API_KEY");

// Sync submits wait for EET (up to the register's timeoutMs).
using var http = new HttpClient { BaseAddress = new Uri(url), Timeout = TimeSpan.FromSeconds(30) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);

// Your own unique receipt id doubles as the idempotency key: repeating the request after a
// network error returns the stored result and never registers the sale twice.
var receipt = $"CS-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
var sale = new
{
    porad_cis = receipt,
    dat_trzby = DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:sszzz"), // ISO 8601 with offset
    celk_trzba = "123.50", // eic_popl, id_jednotky, id_pokl come from the register config
};

using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/sales") { Content = JsonContent.Create(sale) };
request.Headers.Add("Idempotency-Key", receipt);
using var response = await http.SendAsync(request);
var result = await response.Content.ReadFromJsonAsync<JsonElement>();

string Status(JsonElement r) => r.GetProperty("status").GetString()!;

switch (response.StatusCode)
{
    case HttpStatusCode.OK: // EET answered: accepted, verification_ok or rejected
        break;
    case HttpStatusCode.Accepted: // queued or uncertain: the gateway keeps resending
        var id = result.GetProperty("id").GetString();
        for (var i = 0; i < 15 && Status(result) is "queued" or "uncertain"; i++)
        {
            await Task.Delay(TimeSpan.FromSeconds(1));
            result = await http.GetFromJsonAsync<JsonElement>($"/v1/sales/{id}");
        }
        break;
    case HttpStatusCode.Conflict or HttpStatusCode.UnprocessableEntity: // nothing was sent
        foreach (var issue in result.GetProperty("issues").EnumerateArray())
            Console.Error.WriteLine($"{issue.GetProperty("code")}: {issue.GetProperty("message")}");
        return 1;
    default:
        Console.Error.WriteLine($"HTTP {(int)response.StatusCode}: {result}");
        return 1;
}

var pok = result.TryGetProperty("pok", out var p) ? p.GetString() : "-";
Console.WriteLine($"{result.GetProperty("id")}  {Status(result)}  POK {pok}");
foreach (var warning in result.GetProperty("warnings").EnumerateArray())
    Console.WriteLine($"  warning {warning.GetProperty("code")} ({warning.GetProperty("source")}): {warning.GetProperty("message")}");
return Status(result) is "accepted" or "verification_ok" ? 0 : 1;
