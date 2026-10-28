<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** The gateway answered with an error status. */
class ApiException extends EetGatewayException
{
    /**
     * @param string $errorCode Stable machine-readable code from the `{"error":{"code"}}` body, e.g. `not_found`.
     * @param array<string, string> $headers Response headers, names in lower case.
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        public readonly string $errorMessage,
        public readonly array $headers = [],
    ) {
        parent::__construct(sprintf('HTTP %d %s: %s', $status, $errorCode, $errorMessage), $status);
    }
}
