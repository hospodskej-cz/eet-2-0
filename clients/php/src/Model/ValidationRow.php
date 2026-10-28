<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

final class ValidationRow
{
    public function __construct(public readonly int $row, public readonly ValidationResult $result)
    {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self((int) $d['row'], ValidationResult::fromArray($d['result']));
    }
}
