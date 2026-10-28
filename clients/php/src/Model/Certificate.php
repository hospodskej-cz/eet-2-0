<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

final class Certificate
{
    /**
     * @param int $daysLeft Whole days until notAfter; negative once expired.
     * @param bool $active Used for sending right now.
     * @param bool $expiresSoon Valid, but expires within 21 days.
     */
    public function __construct(
        public readonly string $eic,
        public readonly string $subject,
        public readonly string $issuer,
        public readonly string $serialNumber,
        public readonly string $fingerprintSha256,
        public readonly string $notBefore,
        public readonly string $notAfter,
        public readonly int $daysLeft,
        public readonly bool $active,
        public readonly bool $expiresSoon,
        public readonly bool $expired,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            eic: (string) $d['eic'],
            subject: (string) $d['subject'],
            issuer: (string) $d['issuer'],
            serialNumber: (string) $d['serialNumber'],
            fingerprintSha256: (string) $d['fingerprintSha256'],
            notBefore: (string) $d['notBefore'],
            notAfter: (string) $d['notAfter'],
            daysLeft: (int) $d['daysLeft'],
            active: (bool) $d['active'],
            expiresSoon: (bool) $d['expiresSoon'],
            expired: (bool) $d['expired'],
        );
    }
}
