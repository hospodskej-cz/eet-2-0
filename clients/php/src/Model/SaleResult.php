<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** The state of one sale: the body of POST /v1/sales, GET /v1/sales/{id} and queue items. */
final class SaleResult
{
    /**
     * @param string|null $id Record id in the queue; null when nothing was stored (`invalid`).
     * @param string|null $pok Fiscal identification code, `accepted` only.
     * @param string|null $uuid `uuid_zpravy` of the last attempt.
     * @param bool|null $test EET answered from the playground.
     * @param int|null $code EET error code of the last answer (`kod`).
     * @param string|null $reason Why the last attempt has no EET answer: timeout, network, interrupted, ...
     * @param list<SaleWarning> $warnings
     * @param list<Issue> $issues
     * @param string|null $nextAttemptAt Next automatic attempt (ISO 8601 UTC).
     * @param bool|null $overdue No POK 48 hours after the sale (ZoET par. 20); null in verification mode.
     * @param string|null $location `Location` header of the submit response (`/v1/sales/{id}`).
     * @param bool $replayed `Idempotent-Replayed: true`: the stored result of an earlier call with the same key.
     */
    public function __construct(
        public readonly SaleStatus $status,
        public readonly array $warnings = [],
        public readonly int $attempts = 0,
        public readonly ?string $id = null,
        public readonly ?string $register = null,
        public readonly ?SaleData $data = null,
        public readonly ?string $pok = null,
        public readonly ?string $uuid = null,
        public readonly ?bool $test = null,
        public readonly ?int $code = null,
        public readonly ?string $message = null,
        public readonly ?string $reason = null,
        public readonly array $issues = [],
        public readonly ?string $nextAttemptAt = null,
        public readonly ?bool $overdue = null,
        public readonly ?string $createdAt = null,
        public readonly ?string $deadlineAt = null,
        public readonly ?int $httpStatus = null,
        public readonly ?string $globalTransactionId = null,
        public readonly ?string $rawRequest = null,
        public readonly ?string $rawResponse = null,
        public readonly ?string $location = null,
        public readonly bool $replayed = false,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d, ?string $location = null, bool $replayed = false): self
    {
        return new self(
            status: SaleStatus::fromWire($d['status'] ?? null),
            warnings: SaleWarning::listFrom($d),
            attempts: (int) ($d['attempts'] ?? 0),
            id: $d['id'] ?? null,
            register: $d['register'] ?? null,
            data: isset($d['data']) ? SaleData::fromArray($d['data']) : null,
            pok: $d['pok'] ?? null,
            uuid: $d['uuid'] ?? null,
            test: $d['test'] ?? null,
            code: $d['code'] ?? null,
            message: $d['message'] ?? null,
            reason: $d['reason'] ?? null,
            issues: Issue::listFrom($d),
            nextAttemptAt: $d['nextAttemptAt'] ?? null,
            overdue: $d['overdue'] ?? null,
            createdAt: $d['createdAt'] ?? null,
            deadlineAt: $d['deadlineAt'] ?? null,
            httpStatus: $d['httpStatus'] ?? null,
            globalTransactionId: $d['globalTransactionId'] ?? null,
            rawRequest: $d['rawRequest'] ?? null,
            rawResponse: $d['rawResponse'] ?? null,
            location: $location,
            replayed: $replayed,
        );
    }

    /** EET accepted the sale, or (verification mode) found it correct. */
    public function isSuccess(): bool
    {
        return $this->status === SaleStatus::Accepted || $this->status === SaleStatus::VerificationOk;
    }

    /** `queued` or `uncertain`: not decided yet, the gateway keeps going. */
    public function isPending(): bool
    {
        return $this->status === SaleStatus::Queued || $this->status === SaleStatus::Uncertain;
    }

    /** Nothing more will happen without a manual retry. */
    public function isFinal(): bool
    {
        return !$this->isPending();
    }
}
