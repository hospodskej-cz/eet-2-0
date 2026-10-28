using System.Net;

namespace EetGateway.Client;

// EetGatewayException
// ├── TransportException             no HTTP answer: connection refused, DNS, TLS, reset
// │   └── RequestTimeoutException    no answer within the timeout
// ├── InvalidResponseException       an answer that is not the documented JSON
// └── ApiException                   the gateway answered with an error status
//     ├── BadRequestException        400  bad_request
//     ├── UnauthorizedException      401  unauthorized
//     ├── NotFoundException          404  not_found
//     ├── ConflictException          409  not_retryable, in_progress, unknown_register
//     │   └── IdempotencyConflictException   409  Idempotency-Key belongs to another sale
//     ├── PayloadTooLargeException   413  payload_too_large
//     ├── UnsupportedMediaTypeException  415
//     ├── UnprocessableException     422  single_sale_expected
//     └── ServerException            5xx  internal
//
// A sale that failed validation (`invalid`, HTTP 422) or was `rejected` by EET is NOT an
// exception: it comes back as a SaleResult with Status and Issues.
//
// After a TransportException on a submit the sale may or may not have reached the gateway.
// Repeat the call with the same IdempotencyKey: the gateway returns the stored result and
// never registers the sale twice.

/// <summary>Base class of everything this library throws (apart from argument errors).</summary>
public class EetGatewayException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>No HTTP answer was received.</summary>
public class TransportException(string message, Exception? inner = null) : EetGatewayException(message, inner);

/// <summary>The gateway did not answer within the client timeout.</summary>
public sealed class RequestTimeoutException(string message, Exception? inner = null) : TransportException(message, inner);

/// <summary>The gateway answered with something that is not the documented JSON.</summary>
public sealed class InvalidResponseException(string message, HttpStatusCode status, Exception? inner = null)
    : EetGatewayException(message, inner)
{
    public HttpStatusCode Status { get; } = status;
}

/// <summary>The gateway answered with an error status.</summary>
public class ApiException(HttpStatusCode status, string code, string message)
    : EetGatewayException($"HTTP {(int)status} {code}: {message}")
{
    public HttpStatusCode Status { get; } = status;

    /// <summary>Stable machine-readable code from the <c>{"error":{"code"}}</c> body, e.g. <c>not_found</c>.</summary>
    public string Code { get; } = code;

    /// <summary>The server's message, without the status prefix of <see cref="Exception.Message"/>.</summary>
    public string ErrorMessage { get; } = message;
}

/// <summary>400: a query parameter or header is invalid.</summary>
public sealed class BadRequestException(string code, string message) : ApiException(HttpStatusCode.BadRequest, code, message);

/// <summary>401: the API key is missing or wrong.</summary>
public sealed class UnauthorizedException(string code, string message) : ApiException(HttpStatusCode.Unauthorized, code, message);

/// <summary>404: no such record.</summary>
public sealed class NotFoundException(string code, string message) : ApiException(HttpStatusCode.NotFound, code, message);

/// <summary>409: the record is final (<c>not_retryable</c>), being sent (<c>in_progress</c>) or its register is gone.</summary>
public class ConflictException(string code, string message) : ApiException(HttpStatusCode.Conflict, code, message);

/// <summary>409: the Idempotency-Key was already used for a different sale. Nothing was sent.</summary>
public sealed class IdempotencyConflictException(SaleResult result)
    : ConflictException(
        result.Issues.FirstOrDefault()?.Code ?? "idempotency_conflict",
        result.Issues.FirstOrDefault()?.Message ?? "Idempotency-Key was used for another sale.")
{
    public SaleResult Result { get; } = result;
}

/// <summary>413: the body is over the gateway limit (64 KiB a sale, 10 MiB a batch).</summary>
public sealed class PayloadTooLargeException(string code, string message) : ApiException(HttpStatusCode.RequestEntityTooLarge, code, message);

/// <summary>415: the Content-Type is not supported by the endpoint.</summary>
public sealed class UnsupportedMediaTypeException(string code, string message) : ApiException(HttpStatusCode.UnsupportedMediaType, code, message);

/// <summary>422 with an error body, e.g. <c>single_sale_expected</c> (a batch sent to SubmitSaleAsync).</summary>
public sealed class UnprocessableException(string code, string message) : ApiException(HttpStatusCode.UnprocessableEntity, code, message);

/// <summary>5xx: the gateway failed (details only in its log).</summary>
public sealed class ServerException(HttpStatusCode status, string code, string message) : ApiException(status, code, message);
