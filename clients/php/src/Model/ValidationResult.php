<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

final class ValidationResult
{
    /**
     * @param list<SaleWarning> $warnings
     * @param list<Issue> $issues
     * @param SaleData|null $data The EET <Data> that would be sent.
     */
    public function __construct(
        public readonly bool $valid,
        public readonly array $warnings = [],
        public readonly array $issues = [],
        public readonly ?string $register = null,
        public readonly ?SaleData $data = null,
        public readonly ?bool $overeni = null,
        public readonly ?bool $prvniZaslani = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            valid: (bool) $d['valid'],
            warnings: SaleWarning::listFrom($d),
            issues: Issue::listFrom($d),
            register: $d['register'] ?? null,
            data: isset($d['data']) ? SaleData::fromArray($d['data']) : null,
            overeni: $d['overeni'] ?? null,
            prvniZaslani: $d['prvni_zaslani'] ?? null,
        );
    }
}
