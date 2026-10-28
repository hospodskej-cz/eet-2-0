<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

final class BatchRow
{
    /** @param int $row JSON array: position from 1; NDJSON, CSV, XML: line number */
    public function __construct(public readonly int $row, public readonly SaleResult $result)
    {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self((int) $d['row'], SaleResult::fromArray($d['result']));
    }
}
