<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** One message sent to EET for a sale (GET /v1/sales/{id}/attempts). */
final class Attempt
{
    /**
     * @param string $environment "playground" or "production"
     * @param string|null $finishedAt Null while the attempt is running.
     * @param string|null $outcome accepted, verification_ok, rejected, not_sent, uncertain or interrupted
     */
    public function __construct(
        public readonly int $n,
        public readonly string $uuidZpravy,
        public readonly string $datOdesl,
        public readonly bool $prvniZaslani,
        public readonly bool $overeni,
        public readonly string $environment,
        public readonly string $endpoint,
        public readonly string $startedAt,
        public readonly ?string $finishedAt = null,
        public readonly ?string $outcome = null,
        public readonly ?string $reason = null,
        public readonly ?int $code = null,
        public readonly ?string $message = null,
        public readonly ?string $pok = null,
        public readonly ?int $httpStatus = null,
        public readonly ?string $globalTransactionId = null,
        public readonly ?int $durationMs = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            n: (int) $d['n'],
            uuidZpravy: (string) $d['uuid_zpravy'],
            datOdesl: (string) $d['dat_odesl'],
            prvniZaslani: (bool) $d['prvni_zaslani'],
            overeni: (bool) $d['overeni'],
            environment: (string) $d['environment'],
            endpoint: (string) $d['endpoint'],
            startedAt: (string) $d['startedAt'],
            finishedAt: $d['finishedAt'] ?? null,
            outcome: $d['outcome'] ?? null,
            reason: $d['reason'] ?? null,
            code: $d['code'] ?? null,
            message: $d['message'] ?? null,
            pok: $d['pok'] ?? null,
            httpStatus: $d['httpStatus'] ?? null,
            globalTransactionId: $d['globalTransactionId'] ?? null,
            durationMs: $d['durationMs'] ?? null,
        );
    }
}
