<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** One page of GET /v1/queue, newest first. */
final class QueuePage
{
    /**
     * @param list<SaleResult> $items
     * @param string|null $nextCursor Pass as `cursor` for the next page.
     */
    public function __construct(public readonly array $items, public readonly ?string $nextCursor = null)
    {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            array_map(static fn (array $i): SaleResult => SaleResult::fromArray($i), $d['items'] ?? []),
            $d['nextCursor'] ?? null,
        );
    }
}
