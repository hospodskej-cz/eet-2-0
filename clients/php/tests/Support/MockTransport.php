<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests\Support;

use EetGateway\Client\Http\Response;
use EetGateway\Client\Http\Transport;

/** An in-process fake of the gateway: scripted answers, recorded requests. */
final class MockTransport implements Transport
{
    /** @var list<RecordedRequest> */
    public array $requests = [];

    /** @var list<Response|\Throwable> */
    private array $queue = [];

    private Response|\Throwable|null $last = null;

    /**
     * Queues the answer to the next request; the last answer repeats once the queue is empty.
     *
     * @param array<string, mixed>|string|null $body Arrays are sent as JSON.
     * @param array<string, string> $headers
     */
    public function respond(int $status, array|string|null $body = null, array $headers = []): void
    {
        if (is_array($body)) {
            $text = json_encode($body, JSON_THROW_ON_ERROR);
            $headers += ['content-type' => 'application/json'];
        } else {
            $text = $body ?? '';
        }
        $this->queue[] = new Response($status, array_change_key_case($headers, CASE_LOWER), $text);
    }

    /** Queues a transport failure. */
    public function fail(\Throwable $error): void
    {
        $this->queue[] = $error;
    }

    public function send(
        string $method,
        string $url,
        array $headers,
        ?string $body,
        float $timeout,
        float $connectTimeout,
    ): Response {
        $this->requests[] = new RecordedRequest($method, $url, $headers, $body, $timeout, $connectTimeout);
        if ($this->queue !== []) {
            $this->last = array_shift($this->queue);
        }
        if ($this->last === null) {
            throw new \LogicException('no answer queued: call respond() first');
        }
        if ($this->last instanceof \Throwable) {
            throw $this->last;
        }
        return $this->last;
    }

    public function last(): RecordedRequest
    {
        return $this->requests[count($this->requests) - 1];
    }
}
