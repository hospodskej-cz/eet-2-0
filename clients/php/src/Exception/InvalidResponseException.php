<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** The gateway answered with something that is not the documented JSON. */
final class InvalidResponseException extends EetGatewayException
{
    public function __construct(string $message, public readonly int $status, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
