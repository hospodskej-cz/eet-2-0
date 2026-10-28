<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/**
 * Base class of everything this library throws (apart from argument errors).
 *
 *   EetGatewayException
 *   ├── TransportException             no HTTP answer: connection refused, DNS, TLS, reset
 *   │   └── TimeoutException           no answer within the timeout
 *   ├── InvalidResponseException       an answer that is not the documented JSON
 *   └── ApiException                   the gateway answered with an error status
 *       ├── BadRequestException        400  bad_request
 *       ├── UnauthorizedException      401  unauthorized
 *       ├── NotFoundException          404  not_found
 *       ├── ConflictException          409  not_retryable, in_progress, unknown_register
 *       │   └── IdempotencyConflictException   409  Idempotency-Key belongs to another sale
 *       ├── PayloadTooLargeException   413  payload_too_large
 *       ├── UnsupportedMediaTypeException  415
 *       ├── UnprocessableException     422  single_sale_expected
 *       └── ServerException            5xx  internal
 *
 * A sale that failed validation (`invalid`, HTTP 422) or was `rejected` by EET is NOT an
 * exception: it comes back as a SaleResult with `status` and `issues`.
 *
 * After a TransportException on a submit the sale may or may not have reached the gateway.
 * Repeat the call with the same idempotency key: the gateway returns the stored result and never
 * registers the sale twice.
 */
class EetGatewayException extends \RuntimeException
{
}
