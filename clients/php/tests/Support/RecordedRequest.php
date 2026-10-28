<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests\Support;

/** One request as the gateway would have seen it. */
final class RecordedRequest
{
    /** @param array<string, string> $headers */
    public function __construct(
        public readonly string $method,
        public readonly string $url,
        public readonly array $headers,
        public readonly ?string $body,
        public readonly float $timeout = 0.0,
        public readonly float $connectTimeout = 0.0,
    ) {
    }

    /** Path of the URL, still percent-encoded. */
    public function path(): string
    {
        return (string) parse_url($this->url, PHP_URL_PATH);
    }

    /** @return array<string, string> */
    public function query(): array
    {
        $query = [];
        parse_str((string) parse_url($this->url, PHP_URL_QUERY), $query);
        return array_map('strval', $query);
    }

    public function header(string $name): ?string
    {
        foreach ($this->headers as $key => $value) {
            if (strcasecmp($key, $name) === 0) {
                return $value;
            }
        }
        return null;
    }

    /** @return mixed The JSON body, decoded. */
    public function json(): mixed
    {
        return json_decode((string) $this->body, true, 512, JSON_THROW_ON_ERROR);
    }
}
