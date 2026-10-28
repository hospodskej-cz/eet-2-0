<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** A change or remark made while handling a sale (`warnings[]`). */
final class SaleWarning
{
    /** @param string $source "eet", "ingest" or "queue" */
    public function __construct(
        public readonly int $code,
        public readonly string $message,
        public readonly string $source,
        public readonly ?string $field = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self((int) $d['code'], (string) $d['message'], (string) $d['source'], $d['field'] ?? null);
    }

    /**
     * @param array<string, mixed> $d
     * @return list<self>
     */
    public static function listFrom(array $d): array
    {
        return array_map(static fn (array $w): self => self::fromArray($w), $d['warnings'] ?? []);
    }
}
