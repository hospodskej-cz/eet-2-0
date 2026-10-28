<?php

declare(strict_types=1);

namespace EetGateway\Client\Http;

/** An HTTP answer as the client sees it. */
final class Response
{
    /**
     * @param array<string, string> $headers Header names in lower case.
     */
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly string $body,
    ) {
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}
