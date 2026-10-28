<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** Reachability of one EET endpoint (`/health?eet=true`). */
final class EetCheck
{
    public function __construct(
        public readonly string $endpoint,
        public readonly bool $reachable,
        public readonly float $durationMs,
        public readonly string $checkedAt,
        public readonly ?int $httpStatus = null,
        public readonly ?string $error = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            endpoint: (string) $d['endpoint'],
            reachable: (bool) $d['reachable'],
            durationMs: (float) $d['durationMs'],
            checkedAt: (string) $d['checkedAt'],
            httpStatus: $d['httpStatus'] ?? null,
            error: $d['error'] ?? null,
        );
    }
}
