<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** Body of GET /health. A degraded gateway (HTTP 503) is returned, not thrown. */
final class Health
{
    /**
     * @param string $status "ok" or "degraded"
     * @param string $database "ok" or "error"
     * @param list<EetCheck>|null $eet Only with `checkEet: true`.
     */
    public function __construct(
        public readonly string $status,
        public readonly string $version,
        public readonly string $database,
        public readonly ?array $eet = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            (string) $d['status'],
            (string) $d['version'],
            (string) $d['database'],
            isset($d['eet'])
                ? array_map(static fn (array $e): EetCheck => EetCheck::fromArray($e), $d['eet'])
                : null,
        );
    }

    public function isOk(): bool
    {
        return $this->status === 'ok';
    }
}
