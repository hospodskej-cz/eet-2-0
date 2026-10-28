<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

use EetGateway\Client\Model\SaleResult;

/** 409: the Idempotency-Key was already used for a different sale. Nothing was sent. */
final class IdempotencyConflictException extends ConflictException
{
    /** @param array<string, string> $headers */
    public function __construct(public readonly SaleResult $result, array $headers = [])
    {
        $first = $result->issues[0] ?? null;
        parent::__construct(
            409,
            $first?->code ?? 'idempotency_conflict',
            $first?->message ?? 'Idempotency-Key was used for another sale.',
            $headers,
        );
    }
}
