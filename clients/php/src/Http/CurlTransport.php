<?php

declare(strict_types=1);

namespace EetGateway\Client\Http;

use EetGateway\Client\Exception\TimeoutException;
use EetGateway\Client\Exception\TransportException;

/** The default transport: ext-curl. Redirects are never followed (a gateway does not redirect). */
final class CurlTransport implements Transport
{
    public function send(
        string $method,
        string $url,
        array $headers,
        ?string $body,
        float $timeout,
        float $connectTimeout,
    ): Response {
        $lines = ['Expect:']; // no 100-continue round trip for big batches
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }

        $received = [];
        $curl = curl_init($url);
        if ($curl === false) {
            throw new TransportException('curl_init failed');
        }
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT_MS => max(1, (int) round($timeout * 1000)),
            CURLOPT_CONNECTTIMEOUT_MS => max(1, (int) round($connectTimeout * 1000)),
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$received): int {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $received[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($line);
            },
        ];
        if ($method !== 'GET') {
            $options[CURLOPT_POSTFIELDS] = $body ?? '';
        }
        curl_setopt_array($curl, $options);

        $raw = curl_exec($curl);
        if ($raw === false) {
            $message = sprintf('%s %s failed: %s', $method, $url, curl_error($curl));
            if (curl_errno($curl) === CURLE_OPERATION_TIMEDOUT) {
                throw new TimeoutException($message);
            }
            throw new TransportException($message);
        }

        return new Response((int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE), $received, (string) $raw);
    }
}
