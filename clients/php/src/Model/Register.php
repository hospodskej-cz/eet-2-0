<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** A configured cash register and its certificates (GET /v1/registers). */
final class Register
{
    /**
     * @param string $environment "playground" or "production"
     * @param array<string, string> $defaults eic_popl, id_jednotky, id_pokl as far as configured
     * @param list<Certificate> $certificates
     */
    public function __construct(
        public readonly string $id,
        public readonly string $environment,
        public readonly string $endpoint,
        public readonly string $timeZone,
        public readonly array $defaults,
        public readonly array $certificates,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            id: (string) $d['id'],
            environment: (string) $d['environment'],
            endpoint: (string) $d['endpoint'],
            timeZone: (string) $d['timeZone'],
            defaults: $d['defaults'] ?? [],
            certificates: array_map(
                static fn (array $c): Certificate => Certificate::fromArray($c),
                $d['certificates'] ?? [],
            ),
        );
    }
}
