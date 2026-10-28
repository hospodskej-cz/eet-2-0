<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** Why a sale is invalid (`issues[]`). */
final class Issue
{
    public function __construct(
        public readonly string $code,
        public readonly string $message,
        public readonly ?string $field = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self((string) $d['code'], (string) $d['message'], $d['field'] ?? null);
    }

    /**
     * @param array<string, mixed> $d
     * @return list<self>
     */
    public static function listFrom(array $d): array
    {
        return array_map(static fn (array $i): self => self::fromArray($i), $d['issues'] ?? []);
    }
}
