<?php

declare(strict_types=1);

namespace EetGateway\Client\Http;

use EetGateway\Client\Exception\TimeoutException;
use EetGateway\Client\Exception\TransportException;

/**
 * Sends one HTTP request. {@see CurlTransport} is the default; implement this to route requests
 * through Guzzle, a PSR-18 client or a test double.
 */
interface Transport
{
    /**
     * @param array<string, string> $headers Request headers, name => value.
     * @param string|null $body Request body; null for none.
     * @param float $timeout Seconds for the whole request.
     * @param float $connectTimeout Seconds to establish the connection.
     * @throws TimeoutException When no answer arrives in time.
     * @throws TransportException On any other failure to get an answer. An HTTP error status is NOT a failure:
     *                            return it as a Response.
     */
    public function send(
        string $method,
        string $url,
        array $headers,
        ?string $body,
        float $timeout,
        float $connectTimeout,
    ): Response;
}
