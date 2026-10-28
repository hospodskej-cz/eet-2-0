<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** Result of POST /v1/validate. When `issues` is not empty the source could not be read (HTTP 422). */
final class ValidationBatch
{
    /**
     * @param list<ValidationRow> $rows
     * @param list<SaleWarning> $warnings
     * @param list<Issue> $issues
     */
    public function __construct(
        public readonly array $rows,
        public readonly array $warnings = [],
        public readonly array $issues = [],
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            array_map(static fn (array $r): ValidationRow => ValidationRow::fromArray($r), $d['rows'] ?? []),
            SaleWarning::listFrom($d),
            Issue::listFrom($d),
        );
    }

    /** The source was readable and every row is valid. */
    public function isValid(): bool
    {
        if ($this->issues !== []) {
            return false;
        }
        foreach ($this->rows as $row) {
            if (!$row->result->valid) {
                return false;
            }
        }
        return true;
    }
}
