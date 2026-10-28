using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EetGateway.Client;

/// <summary><c>SaleResult.status</c>. A status this library does not know yet reads as <see cref="Unknown"/>.</summary>
[JsonConverter(typeof(SaleStatusConverter))]
public enum SaleStatus
{
    /// <summary>A status newer than this library.</summary>
    Unknown = 0,

    /// <summary>EET registered the sale; <see cref="SaleResult.Pok"/> is set.</summary>
    Accepted,

    /// <summary>Verification mode: EET checked the message and registered nothing.</summary>
    VerificationOk,

    /// <summary>EET answered with an error (<see cref="SaleResult.Code"/>, <see cref="SaleResult.Message"/>).</summary>
    Rejected,

    /// <summary>Stored, not sent yet; the gateway keeps trying.</summary>
    Queued,

    /// <summary>Sent, no answer; the gateway resends safely.</summary>
    Uncertain,

    /// <summary>Failed the local check (<see cref="SaleResult.Issues"/>); nothing was sent.</summary>
    Invalid,
}

/// <summary>Wire names of <see cref="SaleStatus"/> ("verification_ok", ...).</summary>
public static class SaleStatusNames
{
    private static readonly (SaleStatus Status, string Wire)[] Names =
    [
        (SaleStatus.Accepted, "accepted"),
        (SaleStatus.VerificationOk, "verification_ok"),
        (SaleStatus.Rejected, "rejected"),
        (SaleStatus.Queued, "queued"),
        (SaleStatus.Uncertain, "uncertain"),
        (SaleStatus.Invalid, "invalid"),
    ];

    public static string ToWire(this SaleStatus status) =>
        Names.FirstOrDefault(n => n.Status == status).Wire
        ?? throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown has no wire name");

    public static SaleStatus Parse(string? wire) =>
        Names.FirstOrDefault(n => n.Wire == wire).Status;
}

internal sealed class SaleStatusConverter : JsonConverter<SaleStatus>
{
    public override SaleStatus Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        SaleStatusNames.Parse(reader.GetString());

    public override void Write(Utf8JsonWriter writer, SaleStatus value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToWire());
}

/// <summary>A change or remark made while handling a sale (<c>warnings[]</c>).</summary>
public sealed record SaleWarning
{
    [JsonPropertyName("code")] public int Code { get; init; }
    [JsonPropertyName("message")] public string Message { get; init; } = "";

    /// <summary>"eet", "ingest" or "queue".</summary>
    [JsonPropertyName("source")] public string Source { get; init; } = "";

    [JsonPropertyName("field")] public string? Field { get; init; }
}

/// <summary>Why a sale is invalid (<c>issues[]</c>).</summary>
public sealed record Issue
{
    [JsonPropertyName("code")] public string Code { get; init; } = "";
    [JsonPropertyName("message")] public string Message { get; init; } = "";
    [JsonPropertyName("field")] public string? Field { get; init; }
}

/// <summary>The EET <c>&lt;Data&gt;</c> stored for a sale; every attempt sends exactly this.</summary>
public sealed record SaleData
{
    [JsonPropertyName("eic_popl")] public string EicPopl { get; init; } = "";
    [JsonPropertyName("eic_poverujiciho")] public string? EicPoverujiciho { get; init; }
    [JsonPropertyName("povereni_vice_popl")] public bool? PovereniVicePopl { get; init; }
    [JsonPropertyName("id_jednotky")] public string IdJednotky { get; init; } = "";
    [JsonPropertyName("id_pokl")] public string IdPokl { get; init; } = "";
    [JsonPropertyName("porad_cis")] public string PoradCis { get; init; } = "";
    [JsonPropertyName("dat_trzby")] public string DatTrzby { get; init; } = "";
    [JsonPropertyName("celk_trzba")] public string CelkTrzba { get; init; } = "";
    [JsonPropertyName("urceno_cerp_zuct")] public string? UrcenoCerpZuct { get; init; }
    [JsonPropertyName("cerp_zuct")] public string? CerpZuct { get; init; }
}

/// <summary>The state of one sale: the body of POST /v1/sales, GET /v1/sales/{id} and queue items.</summary>
public sealed record SaleResult
{
    /// <summary>Record id in the queue; null when nothing was stored (<see cref="SaleStatus.Invalid"/>).</summary>
    [JsonPropertyName("id")] public string? Id { get; init; }

    [JsonPropertyName("status")] public SaleStatus Status { get; init; }
    [JsonPropertyName("register")] public string? Register { get; init; }
    [JsonPropertyName("data")] public SaleData? Data { get; init; }

    /// <summary>Fiscal identification code, <see cref="SaleStatus.Accepted"/> only.</summary>
    [JsonPropertyName("pok")] public string? Pok { get; init; }

    /// <summary><c>uuid_zpravy</c> of the last attempt.</summary>
    [JsonPropertyName("uuid")] public string? Uuid { get; init; }

    /// <summary>EET answered from the playground.</summary>
    [JsonPropertyName("test")] public bool? Test { get; init; }

    /// <summary>EET error code of the last answer (<c>kod</c>).</summary>
    [JsonPropertyName("code")] public int? Code { get; init; }

    [JsonPropertyName("message")] public string? Message { get; init; }

    /// <summary>Why the last attempt has no EET answer: timeout, network, interrupted, ...</summary>
    [JsonPropertyName("reason")] public string? Reason { get; init; }

    [JsonPropertyName("warnings")] public IReadOnlyList<SaleWarning> Warnings { get; init; } = [];
    [JsonPropertyName("issues")] public IReadOnlyList<Issue> Issues { get; init; } = [];
    [JsonPropertyName("attempts")] public int Attempts { get; init; }

    /// <summary>Next automatic attempt (ISO 8601 UTC).</summary>
    [JsonPropertyName("nextAttemptAt")] public string? NextAttemptAt { get; init; }

    /// <summary>No POK 48 hours after the sale (ZoET §20); null in verification mode.</summary>
    [JsonPropertyName("overdue")] public bool? Overdue { get; init; }

    [JsonPropertyName("createdAt")] public string? CreatedAt { get; init; }
    [JsonPropertyName("deadlineAt")] public string? DeadlineAt { get; init; }
    [JsonPropertyName("httpStatus")] public int? HttpStatus { get; init; }
    [JsonPropertyName("globalTransactionId")] public string? GlobalTransactionId { get; init; }

    /// <summary>Debug only.</summary>
    [JsonPropertyName("rawRequest")] public string? RawRequest { get; init; }

    /// <summary>Debug only.</summary>
    [JsonPropertyName("rawResponse")] public string? RawResponse { get; init; }

    /// <summary><c>Location</c> header of the submit response (<c>/v1/sales/{id}</c>).</summary>
    [JsonIgnore] public string? Location { get; init; }

    /// <summary><c>Idempotent-Replayed: true</c>: the stored result of an earlier call with the same key.</summary>
    [JsonIgnore] public bool Replayed { get; init; }

    /// <summary>EET accepted the sale, or (verification mode) found it correct.</summary>
    [JsonIgnore] public bool IsSuccess => Status is SaleStatus.Accepted or SaleStatus.VerificationOk;

    /// <summary><see cref="SaleStatus.Queued"/> or <see cref="SaleStatus.Uncertain"/>: not decided yet.</summary>
    [JsonIgnore] public bool IsPending => Status is SaleStatus.Queued or SaleStatus.Uncertain;

    /// <summary>Nothing more will happen without a manual retry.</summary>
    [JsonIgnore] public bool IsFinal => !IsPending;
}

public sealed record BatchRow
{
    /// <summary>JSON array: position from 1; NDJSON, CSV, XML: line number.</summary>
    [JsonPropertyName("row")] public int Row { get; init; }

    [JsonPropertyName("result")] public SaleResult Result { get; init; } = new();
}

/// <summary>Result of POST /v1/sales/batch. When <see cref="Issues"/> is set the source could not be read (422).</summary>
public sealed record BatchResult
{
    [JsonPropertyName("rows")] public IReadOnlyList<BatchRow> Rows { get; init; } = [];
    [JsonPropertyName("warnings")] public IReadOnlyList<SaleWarning> Warnings { get; init; } = [];
    [JsonPropertyName("issues")] public IReadOnlyList<Issue> Issues { get; init; } = [];
}

public sealed record ValidationResult
{
    [JsonPropertyName("valid")] public bool Valid { get; init; }
    [JsonPropertyName("register")] public string? Register { get; init; }

    /// <summary>The EET <c>&lt;Data&gt;</c> that would be sent.</summary>
    [JsonPropertyName("data")] public SaleData? Data { get; init; }

    [JsonPropertyName("overeni")] public bool? Overeni { get; init; }
    [JsonPropertyName("prvni_zaslani")] public bool? PrvniZaslani { get; init; }
    [JsonPropertyName("warnings")] public IReadOnlyList<SaleWarning> Warnings { get; init; } = [];
    [JsonPropertyName("issues")] public IReadOnlyList<Issue> Issues { get; init; } = [];
}

public sealed record ValidationRow
{
    [JsonPropertyName("row")] public int Row { get; init; }
    [JsonPropertyName("result")] public ValidationResult Result { get; init; } = new();
}

/// <summary>Result of POST /v1/validate. When <see cref="Issues"/> is set the source could not be read (422).</summary>
public sealed record ValidationBatch
{
    [JsonPropertyName("rows")] public IReadOnlyList<ValidationRow> Rows { get; init; } = [];
    [JsonPropertyName("warnings")] public IReadOnlyList<SaleWarning> Warnings { get; init; } = [];
    [JsonPropertyName("issues")] public IReadOnlyList<Issue> Issues { get; init; } = [];

    /// <summary>The source was readable and every row is valid.</summary>
    [JsonIgnore] public bool IsValid => Issues.Count == 0 && Rows.All(r => r.Result.Valid);
}

/// <summary>One message sent to EET for a sale (GET /v1/sales/{id}/attempts).</summary>
public sealed record Attempt
{
    [JsonPropertyName("n")] public int N { get; init; }
    [JsonPropertyName("uuid_zpravy")] public string UuidZpravy { get; init; } = "";
    [JsonPropertyName("dat_odesl")] public string DatOdesl { get; init; } = "";
    [JsonPropertyName("prvni_zaslani")] public bool PrvniZaslani { get; init; }
    [JsonPropertyName("overeni")] public bool Overeni { get; init; }

    /// <summary>"playground" or "production".</summary>
    [JsonPropertyName("environment")] public string Environment { get; init; } = "";

    [JsonPropertyName("endpoint")] public string Endpoint { get; init; } = "";
    [JsonPropertyName("startedAt")] public string StartedAt { get; init; } = "";

    /// <summary>Null while the attempt is running.</summary>
    [JsonPropertyName("finishedAt")] public string? FinishedAt { get; init; }

    /// <summary>accepted, verification_ok, rejected, not_sent, uncertain or interrupted.</summary>
    [JsonPropertyName("outcome")] public string? Outcome { get; init; }

    [JsonPropertyName("reason")] public string? Reason { get; init; }
    [JsonPropertyName("code")] public int? Code { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("pok")] public string? Pok { get; init; }
    [JsonPropertyName("httpStatus")] public int? HttpStatus { get; init; }
    [JsonPropertyName("globalTransactionId")] public string? GlobalTransactionId { get; init; }
    [JsonPropertyName("durationMs")] public int? DurationMs { get; init; }
}

internal sealed record AttemptList
{
    [JsonPropertyName("items")] public IReadOnlyList<Attempt> Items { get; init; } = [];
}

/// <summary>One page of GET /v1/queue, newest first.</summary>
public sealed record QueuePage
{
    [JsonPropertyName("items")] public IReadOnlyList<SaleResult> Items { get; init; } = [];

    /// <summary>Pass as <see cref="QueueQuery.Cursor"/> for the next page.</summary>
    [JsonPropertyName("nextCursor")] public string? NextCursor { get; init; }
}

public sealed record Certificate
{
    [JsonPropertyName("eic")] public string Eic { get; init; } = "";
    [JsonPropertyName("subject")] public string Subject { get; init; } = "";
    [JsonPropertyName("issuer")] public string Issuer { get; init; } = "";
    [JsonPropertyName("serialNumber")] public string SerialNumber { get; init; } = "";
    [JsonPropertyName("fingerprintSha256")] public string FingerprintSha256 { get; init; } = "";
    [JsonPropertyName("notBefore")] public string NotBefore { get; init; } = "";
    [JsonPropertyName("notAfter")] public string NotAfter { get; init; } = "";

    /// <summary>Whole days until <see cref="NotAfter"/>; negative once expired.</summary>
    [JsonPropertyName("daysLeft")] public int DaysLeft { get; init; }

    /// <summary>Used for sending right now.</summary>
    [JsonPropertyName("active")] public bool Active { get; init; }

    /// <summary>Valid, but expires within 21 days.</summary>
    [JsonPropertyName("expiresSoon")] public bool ExpiresSoon { get; init; }

    [JsonPropertyName("expired")] public bool Expired { get; init; }
}

/// <summary>A configured cash register and its certificates (GET /v1/registers).</summary>
public sealed record Register
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";

    /// <summary>"playground" or "production".</summary>
    [JsonPropertyName("environment")] public string Environment { get; init; } = "";

    [JsonPropertyName("endpoint")] public string Endpoint { get; init; } = "";

    /// <summary><c>eic_popl</c>, <c>id_jednotky</c>, <c>id_pokl</c> as far as configured.</summary>
    [JsonPropertyName("defaults")] public IReadOnlyDictionary<string, string> Defaults { get; init; } = new Dictionary<string, string>();

    [JsonPropertyName("timeZone")] public string TimeZone { get; init; } = "";
    [JsonPropertyName("certificates")] public IReadOnlyList<Certificate> Certificates { get; init; } = [];
}

internal sealed record RegisterList
{
    [JsonPropertyName("items")] public IReadOnlyList<Register> Items { get; init; } = [];
}

/// <summary>Reachability of one EET endpoint (<c>/health?eet=true</c>).</summary>
public sealed record EetCheck
{
    [JsonPropertyName("endpoint")] public string Endpoint { get; init; } = "";
    [JsonPropertyName("reachable")] public bool Reachable { get; init; }
    [JsonPropertyName("httpStatus")] public int? HttpStatus { get; init; }
    [JsonPropertyName("durationMs")] public double DurationMs { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
    [JsonPropertyName("checkedAt")] public string CheckedAt { get; init; } = "";
}

/// <summary>Body of GET /health. A degraded gateway (HTTP 503) is returned, not thrown.</summary>
public sealed record Health
{
    /// <summary>"ok" or "degraded".</summary>
    [JsonPropertyName("status")] public string Status { get; init; } = "";

    [JsonPropertyName("version")] public string Version { get; init; } = "";

    /// <summary>"ok" or "error".</summary>
    [JsonPropertyName("database")] public string Database { get; init; } = "";

    /// <summary>Only with <c>checkEet: true</c>.</summary>
    [JsonPropertyName("eet")] public IReadOnlyList<EetCheck>? Eet { get; init; }

    [JsonIgnore] public bool IsOk => Status == "ok";
}

// --- request side ---------------------------------------------------------------------------

/// <summary>
/// One sale as the gateway accepts it. <c>eic_popl</c>, <c>id_jednotky</c> and <c>id_pokl</c> come
/// from the register configuration unless set here. Fields the typed model lacks go to
/// <see cref="Extra"/> (docs/INGEST.md); for other body formats use <c>SubmitSaleRawAsync</c>.
/// </summary>
public sealed record SaleInput
{
    /// <summary>Written as ISO 8601 with offset.</summary>
    [JsonPropertyName("dat_trzby")] public required DateTimeOffset DatTrzby { get; init; }

    /// <summary>Written as a two-place string ("123.50").</summary>
    [JsonPropertyName("celk_trzba"), JsonConverter(typeof(AmountConverter))]
    public required decimal CelkTrzba { get; init; }

    [JsonPropertyName("porad_cis")] public string? PoradCis { get; init; }
    [JsonPropertyName("eic_popl")] public string? EicPopl { get; init; }
    [JsonPropertyName("eic_poverujiciho")] public string? EicPoverujiciho { get; init; }
    [JsonPropertyName("povereni_vice_popl")] public bool? PovereniVicePopl { get; init; }
    [JsonPropertyName("id_jednotky")] public string? IdJednotky { get; init; }
    [JsonPropertyName("id_pokl")] public string? IdPokl { get; init; }

    [JsonPropertyName("urceno_cerp_zuct"), JsonConverter(typeof(NullableAmountConverter))]
    public decimal? UrcenoCerpZuct { get; init; }

    [JsonPropertyName("cerp_zuct"), JsonConverter(typeof(NullableAmountConverter))]
    public decimal? CerpZuct { get; init; }

    [JsonPropertyName("overeni")] public bool? Overeni { get; init; }
    [JsonPropertyName("prvni_zaslani")] public bool? PrvniZaslani { get; init; }
    [JsonPropertyName("register")] public string? Register { get; init; }

    /// <summary>Any further field the ingest understands.</summary>
    [JsonExtensionData] public Dictionary<string, object?>? Extra { get; init; }
}

internal sealed class AmountConverter : JsonConverter<decimal>
{
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.String
            ? decimal.Parse(reader.GetString()!, CultureInfo.InvariantCulture)
            : reader.GetDecimal();

    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToString("0.00", CultureInfo.InvariantCulture));
}

internal sealed class NullableAmountConverter : JsonConverter<decimal?>
{
    private static readonly AmountConverter Inner = new();

    public override decimal? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null ? null : Inner.Read(ref reader, typeof(decimal), options);

    public override void Write(Utf8JsonWriter writer, decimal? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else Inner.Write(writer, value.Value, options);
    }
}

/// <summary>How a submit waits for EET.</summary>
public enum SubmitMode
{
    /// <summary>Wait for the first attempt (default for a single sale).</summary>
    Sync,

    /// <summary>Store, answer 202 at once, send in the background (default for a batch).</summary>
    Async,
}

/// <summary>Query and header options of the submit endpoints.</summary>
public sealed record SubmitOptions
{
    /// <summary>1-255 printable ASCII characters. Repeating a call with the same key returns the stored result.</summary>
    public string? IdempotencyKey { get; init; }

    public SubmitMode? Mode { get; init; }

    /// <summary>Verification mode (<c>overeni</c>): EET checks the message and registers nothing.</summary>
    public bool? Verify { get; init; }

    /// <summary>Register id; may also come from the input field <c>register</c>.</summary>
    public string? Register { get; init; }
}

/// <summary>Query options of POST /v1/validate.</summary>
public sealed record ValidateOptions
{
    public bool? Verify { get; init; }
    public string? Register { get; init; }
}

/// <summary>Filters of GET /v1/queue.</summary>
public sealed record QueueQuery
{
    public IReadOnlyList<SaleStatus>? Status { get; init; }
    public string? Register { get; init; }

    /// <summary><c>dat_trzby</c> from (inclusive).</summary>
    public DateTimeOffset? From { get; init; }

    /// <summary><c>dat_trzby</c> to (exclusive).</summary>
    public DateTimeOffset? To { get; init; }

    /// <summary>Only sales without POK 48 h after they happened (true), or only the others (false).</summary>
    public bool? Overdue { get; init; }

    /// <summary>Page size, 1-500 (default 50).</summary>
    public int? Limit { get; init; }

    public string? Cursor { get; init; }
}
