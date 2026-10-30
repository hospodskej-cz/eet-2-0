package cz.hospodskej.eetgateway;

/**
 * Base class of everything this library throws.
 *
 * <pre>
 * EetGatewayException
 * ├── TransportException           no HTTP answer: connection refused, DNS, TLS, reset
 * │   └── RequestTimeoutException  no answer within the timeout
 * ├── InvalidResponseException     an answer that is not the documented JSON
 * └── ApiException                 the gateway answered with an error status
 *     ├── BadRequestException      400  bad_request
 *     ├── AuthenticationException  401  unauthorized
 *     ├── NotFoundException        404  not_found
 *     ├── ConflictException        409  not_retryable, in_progress, unknown_register
 *     │   └── IdempotencyConflictException  409  Idempotency-Key belongs to another sale
 *     ├── PayloadTooLargeException 413  payload_too_large
 *     ├── UnsupportedMediaTypeException  415
 *     ├── UnprocessableException   422  single_sale_expected
 *     └── ServerException          5xx  internal
 * </pre>
 *
 * A sale that failed validation ({@code invalid}, HTTP 422) or was {@code rejected} by EET is
 * <em>not</em> an exception: it comes back as a {@link SaleResult} with {@code status} and {@code
 * issues}.
 *
 * <p>After a {@link TransportException} on a submit the sale may or may not have reached the
 * gateway. Repeat the call with the same {@code Idempotency-Key}: the gateway returns the stored
 * result and never registers the sale twice.
 */
public class EetGatewayException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public EetGatewayException(String message) {
    super(message);
  }

  public EetGatewayException(String message, Throwable cause) {
    super(message, cause);
  }
}
