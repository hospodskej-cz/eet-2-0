<?php

declare(strict_types=1);

namespace EetGateway\Client;

use EetGateway\Client\Exception\ApiException;
use EetGateway\Client\Exception\BadRequestException;
use EetGateway\Client\Exception\ConflictException;
use EetGateway\Client\Exception\IdempotencyConflictException;
use EetGateway\Client\Exception\InvalidResponseException;
use EetGateway\Client\Exception\NotFoundException;
use EetGateway\Client\Exception\PayloadTooLargeException;
use EetGateway\Client\Exception\ServerException;
use EetGateway\Client\Exception\UnauthorizedException;
use EetGateway\Client\Exception\UnprocessableException;
use EetGateway\Client\Exception\UnsupportedMediaTypeException;
use EetGateway\Client\Http\CurlTransport;
use EetGateway\Client\Http\Response;
use EetGateway\Client\Http\Transport;
use EetGateway\Client\Model\Attempt;
use EetGateway\Client\Model\BatchResult;
use EetGateway\Client\Model\Health;
use EetGateway\Client\Model\QueuePage;
use EetGateway\Client\Model\Register;
use EetGateway\Client\Model\SaleInput;
use EetGateway\Client\Model\SaleResult;
use EetGateway\Client\Model\SaleStatus;
use EetGateway\Client\Model\SubmitMode;
use EetGateway\Client\Model\ValidationBatch;

/**
 * Client for one EET Gateway (HTTP API v1).
 *
 *     $client = new Client('http://localhost:8080', apiKey: getenv('EET_API_KEY'));
 *     $result = $client->submitSale(
 *         ['porad_cis' => 'R-1001', 'dat_trzby' => date('c'), 'celk_trzba' => '123.50'],
 *         idempotencyKey: 'R-1001',
 *     );
 *     if ($result->isPending()) {
 *         $result = $client->waitForSale($result);
 *     }
 *
 * `$apiKey` may be null only for a gateway started with `--dev`. `$timeout` (seconds) bounds every
 * request; a synchronous submit waits for EET, up to the register's `timeoutMs` (10 s by default),
 * so keep it above that. The client never retries on its own: repeat a submit yourself with the
 * same `$idempotencyKey`.
 */
final class Client
{
    public const VERSION = '0.1.1';

    private const JSON = 'application/json';

    private readonly string $baseUrl;
    private readonly string $userAgent;
    private readonly Transport $transport;

    public function __construct(
        string $baseUrl,
        private readonly ?string $apiKey = null,
        private readonly float $timeout = 30.0,
        private readonly float $connectTimeout = 5.0,
        ?Transport $transport = null,
        ?string $userAgent = null,
    ) {
        if (!str_starts_with($baseUrl, 'http://') && !str_starts_with($baseUrl, 'https://')) {
            throw new \InvalidArgumentException('baseUrl must start with http:// or https://');
        }
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->transport = $transport ?? new CurlTransport();
        $this->userAgent = $userAgent ?? 'eet-gateway-client-php/' . self::VERSION;
    }

    // --- sales ------------------------------------------------------------------------------

    /**
     * POST /v1/sales: validates, stores and sends one sale.
     *
     * Returns the SaleResult for HTTP 200 (accepted, verification_ok, rejected), 202 (queued,
     * uncertain: use waitForSale()) and 422 (invalid: see `issues`, nothing was sent).
     *
     * @param SaleInput|array<string, mixed> $sale
     * @param SubmitMode|string|null $mode "sync" (default; waits for the first attempt) or "async" (answers 202 at once)
     * @param bool|null $verify Verification mode: EET checks the message and registers nothing.
     * @throws IdempotencyConflictException The key belongs to another sale (409).
     */
    public function submitSale(
        SaleInput|array $sale,
        ?string $idempotencyKey = null,
        SubmitMode|string|null $mode = null,
        ?bool $verify = null,
        ?string $register = null,
    ): SaleResult {
        return $this->submitSaleRaw($this->encode($sale), self::JSON, $idempotencyKey, $mode, $verify, $register);
    }

    /** submitSale() for a body you already serialized: XML (`<Data>`, `<Trzba>`), JSON, form. */
    public function submitSaleRaw(
        string $body,
        string $contentType,
        ?string $idempotencyKey = null,
        SubmitMode|string|null $mode = null,
        ?bool $verify = null,
        ?string $register = null,
    ): SaleResult {
        $response = $this->send(
            'submitSale',
            query: ['mode' => $this->mode($mode), 'verify' => $verify, 'register' => $register],
            body: $body,
            contentType: $contentType,
            idempotencyKey: $idempotencyKey,
        );
        return $this->saleResult($response, [200, 202, 422]);
    }

    /**
     * POST /v1/sales/batch: resending after an outage or migration (default mode: async).
     *
     * Each row is stored and sent on its own and keyed `<idempotencyKey>:<row>`. HTTP 200 and 422
     * (the source could not be read: `issues`) both return a BatchResult.
     *
     * @param iterable<SaleInput|array<string, mixed>> $sales
     */
    public function submitBatch(
        iterable $sales,
        ?string $idempotencyKey = null,
        SubmitMode|string|null $mode = null,
        ?bool $verify = null,
        ?string $register = null,
    ): BatchResult {
        return $this->submitBatchRaw($this->encodeList($sales), self::JSON, $idempotencyKey, $mode, $verify, $register);
    }

    /** submitBatch() for NDJSON (`application/x-ndjson`), CSV (`text/csv`) or XML. */
    public function submitBatchRaw(
        string $body,
        string $contentType,
        ?string $idempotencyKey = null,
        SubmitMode|string|null $mode = null,
        ?bool $verify = null,
        ?string $register = null,
    ): BatchResult {
        $response = $this->send(
            'submitBatch',
            query: ['mode' => $this->mode($mode), 'verify' => $verify, 'register' => $register],
            body: $body,
            contentType: $contentType,
            idempotencyKey: $idempotencyKey,
        );
        return BatchResult::fromArray($this->json($response, [200, 422]));
    }

    /**
     * GET /v1/sales/{id}: the current state.
     *
     * @throws NotFoundException
     */
    public function getSale(string $id): SaleResult
    {
        return SaleResult::fromArray($this->json($this->send('getSale', ['id' => $id]), [200]));
    }

    /**
     * GET /v1/sales/{id}/attempts: every message sent for the sale, oldest first.
     *
     * @return list<Attempt>
     */
    public function getSaleAttempts(string $id): array
    {
        $body = $this->json($this->send('getSaleAttempts', ['id' => $id]), [200]);
        return array_map(static fn (array $a): Attempt => Attempt::fromArray($a), $body['items'] ?? []);
    }

    /**
     * POST /v1/sales/{id}/retry: sends a queued, uncertain or rejected sale now.
     *
     * @throws ConflictException not_retryable, in_progress or unknown_register
     */
    public function retrySale(string $id): SaleResult
    {
        return $this->saleResult($this->send('retrySale', ['id' => $id]), [200, 202]);
    }

    /**
     * Polls getSale() until the sale is neither queued nor uncertain. After `$timeout` seconds it
     * returns the last state, so check isPending(): the gateway keeps resending in the background.
     */
    public function waitForSale(SaleResult|string $sale, float $timeout = 30.0, float $interval = 1.0): SaleResult
    {
        if ($sale instanceof SaleResult) {
            if ($sale->isFinal() || $sale->id === null) {
                return $sale;
            }
            $id = $sale->id;
            $current = $sale;
        } else {
            $id = $sale;
            $current = $this->getSale($id);
        }
        $deadline = microtime(true) + $timeout;
        while ($current->isPending() && microtime(true) < $deadline) {
            usleep((int) round($interval * 1_000_000));
            $current = $this->getSale($id);
        }
        return $current;
    }

    // --- queue, registers, validation -------------------------------------------------------

    /**
     * GET /v1/queue: one page, newest first (`$limit` 1-500, default 50).
     *
     * @param SaleStatus|string|list<SaleStatus|string>|null $status One status or several.
     * @param \DateTimeInterface|string|null $from `dat_trzby` from (inclusive)
     * @param \DateTimeInterface|string|null $to `dat_trzby` to (exclusive)
     * @param bool|null $overdue Only sales without POK 48 h after they happened (true), or only the others.
     */
    public function listQueue(
        SaleStatus|string|array|null $status = null,
        ?string $register = null,
        \DateTimeInterface|string|null $from = null,
        \DateTimeInterface|string|null $to = null,
        ?bool $overdue = null,
        ?int $limit = null,
        ?string $cursor = null,
    ): QueuePage {
        if (is_array($status)) {
            $status = implode(',', array_map(static fn (SaleStatus|string $s): string => $s instanceof SaleStatus ? $s->value : $s, $status));
        } elseif ($status instanceof SaleStatus) {
            $status = $status->value;
        }
        $response = $this->send('listQueue', query: [
            'status' => $status,
            'register' => $register,
            'from' => $from instanceof \DateTimeInterface ? $from->format('c') : $from,
            'to' => $to instanceof \DateTimeInterface ? $to->format('c') : $to,
            'overdue' => $overdue,
            'limit' => $limit,
            'cursor' => $cursor,
        ]);
        return QueuePage::fromArray($this->json($response, [200]));
    }

    /**
     * Every sale matching the listQueue() filters, following `nextCursor` page by page.
     *
     * @param SaleStatus|string|list<SaleStatus|string>|null $status
     * @param \DateTimeInterface|string|null $from
     * @param \DateTimeInterface|string|null $to
     * @return \Generator<int, SaleResult>
     */
    public function iterateQueue(
        SaleStatus|string|array|null $status = null,
        ?string $register = null,
        \DateTimeInterface|string|null $from = null,
        \DateTimeInterface|string|null $to = null,
        ?bool $overdue = null,
        ?int $limit = null,
    ): \Generator {
        $cursor = null;
        do {
            $page = $this->listQueue($status, $register, $from, $to, $overdue, $limit, $cursor);
            foreach ($page->items as $item) {
                yield $item;
            }
            $cursor = $page->nextCursor;
        } while ($cursor !== null && $cursor !== '');
    }

    /**
     * GET /v1/registers: registers with certificate validity (`daysLeft`, `expiresSoon`).
     *
     * @return list<Register>
     */
    public function listRegisters(): array
    {
        $body = $this->json($this->send('listRegisters'), [200]);
        return array_map(static fn (array $r): Register => Register::fromArray($r), $body['items'] ?? []);
    }

    /**
     * POST /v1/validate: the same ingest as a submit, but nothing is stored or sent.
     *
     * @param iterable<SaleInput|array<string, mixed>> $sales
     */
    public function validateSales(iterable $sales, ?bool $verify = null, ?string $register = null): ValidationBatch
    {
        return $this->validateSalesRaw($this->encodeList($sales), self::JSON, $verify, $register);
    }

    /** validateSales() for NDJSON, CSV, XML or a single JSON object. */
    public function validateSalesRaw(string $body, string $contentType, ?bool $verify = null, ?string $register = null): ValidationBatch
    {
        $response = $this->send(
            'validateSales',
            query: ['verify' => $verify, 'register' => $register],
            body: $body,
            contentType: $contentType,
        );
        return ValidationBatch::fromArray($this->json($response, [200, 422]));
    }

    // --- system -----------------------------------------------------------------------------

    /**
     * GET /health (public). A degraded gateway (HTTP 503) is returned, not thrown.
     *
     * @param bool $checkEet Also probe every EET endpoint (the gateway caches the probe for 60 s).
     */
    public function health(bool $checkEet = false): Health
    {
        $response = $this->send('health', query: ['eet' => $checkEet ? true : null], authorize: false);
        return Health::fromArray($this->json($response, [200, 503]));
    }

    /**
     * GET /openapi.json (public): the OpenAPI 3.1 document of the running gateway.
     *
     * @return array<string, mixed>
     */
    public function getOpenApi(): array
    {
        return $this->json($this->send('openapi', authorize: false), [200]);
    }

    /** GET /docs (public): the interactive API reference as HTML. */
    public function getDocs(): string
    {
        $response = $this->send('docs', authorize: false);
        if ($response->status !== 200) {
            throw $this->error($response);
        }
        return $response->body;
    }

    // --- internals --------------------------------------------------------------------------

    /**
     * @param array<string, string> $path
     * @param array<string, scalar|null> $query
     */
    private function send(
        string $operation,
        array $path = [],
        array $query = [],
        ?string $body = null,
        ?string $contentType = null,
        ?string $idempotencyKey = null,
        bool $authorize = true,
    ): Response {
        [$method, $template] = Operations::ALL[$operation];
        foreach ($path as $name => $value) {
            $template = str_replace('{' . $name . '}', rawurlencode($value), $template);
        }
        $pairs = [];
        foreach ($query as $name => $value) {
            if ($value !== null) {
                $text = is_bool($value) ? ($value ? 'true' : 'false') : (string) $value;
                $pairs[] = rawurlencode($name) . '=' . rawurlencode($text);
            }
        }
        $url = $this->baseUrl . $template . ($pairs === [] ? '' : '?' . implode('&', $pairs));

        $headers = ['Accept' => self::JSON, 'User-Agent' => $this->userAgent];
        if ($authorize && $this->apiKey !== null && $this->apiKey !== '') {
            $headers['Authorization'] = 'Bearer ' . $this->apiKey;
        }
        if ($idempotencyKey !== null) {
            if (preg_match('/^[\x21-\x7e]{1,255}\z/', $idempotencyKey) !== 1) {
                throw new \InvalidArgumentException('idempotencyKey must be 1-255 printable ASCII characters');
            }
            $headers['Idempotency-Key'] = $idempotencyKey;
        }
        if ($body !== null) {
            $headers['Content-Type'] = $contentType ?? self::JSON;
        }

        return $this->transport->send($method, $url, $headers, $body, $this->timeout, $this->connectTimeout);
    }

    private function mode(SubmitMode|string|null $mode): ?string
    {
        return $mode instanceof SubmitMode ? $mode->value : $mode;
    }

    /** @param SaleInput|array<string, mixed> $sale */
    private function encode(SaleInput|array $sale): string
    {
        return $this->toJson($sale instanceof SaleInput ? $sale->toArray() : SaleInput::normalize($sale));
    }

    /** @param iterable<SaleInput|array<string, mixed>> $sales */
    private function encodeList(iterable $sales): string
    {
        $rows = [];
        foreach ($sales as $sale) {
            $rows[] = $sale instanceof SaleInput ? $sale->toArray() : SaleInput::normalize($sale);
        }
        return $this->toJson($rows);
    }

    private function toJson(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @param list<int> $accept
     * @return array<string, mixed>
     */
    private function json(Response $response, array $accept): array
    {
        if (!in_array($response->status, $accept, true)) {
            throw $this->error($response);
        }
        $body = $this->decode($response);
        if (!is_array($body)) {
            throw new InvalidResponseException(sprintf('HTTP %d: the body is not a JSON object', $response->status), $response->status);
        }
        return $body;
    }

    /** @param list<int> $accept */
    private function saleResult(Response $response, array $accept): SaleResult
    {
        $body = $this->tryDecode($response->body);
        $isSale = is_array($body) && array_key_exists('status', $body);
        if ($response->status === 409 && $isSale) {
            throw new IdempotencyConflictException(SaleResult::fromArray($body), $response->headers);
        }
        if (!in_array($response->status, $accept, true) || !$isSale) {
            throw $this->error($response);
        }
        return SaleResult::fromArray(
            $body,
            $response->header('location'),
            strtolower($response->header('idempotent-replayed') ?? '') === 'true',
        );
    }

    private function error(Response $response): ApiException
    {
        $code = 'http_error';
        $message = sprintf('unexpected HTTP %d', $response->status);
        $body = $this->tryDecode($response->body);
        if (is_array($body) && is_array($body['error'] ?? null)) {
            $code = (string) ($body['error']['code'] ?? $code);
            $message = (string) ($body['error']['message'] ?? $message);
        } elseif (is_array($body) && is_array($body['issues'][0] ?? null)) {
            $code = (string) ($body['issues'][0]['code'] ?? $code);
            $message = (string) ($body['issues'][0]['message'] ?? $message);
        } elseif ($body === null && trim($response->body) !== '') {
            $message = substr(trim($response->body), 0, 200);
        }

        $status = $response->status;
        return match (true) {
            $status === 400 => new BadRequestException($status, $code, $message, $response->headers),
            $status === 401 => new UnauthorizedException($status, $code, $message, $response->headers),
            $status === 404 => new NotFoundException($status, $code, $message, $response->headers),
            $status === 409 => new ConflictException($status, $code, $message, $response->headers),
            $status === 413 => new PayloadTooLargeException($status, $code, $message, $response->headers),
            $status === 415 => new UnsupportedMediaTypeException($status, $code, $message, $response->headers),
            $status === 422 => new UnprocessableException($status, $code, $message, $response->headers),
            $status >= 500 => new ServerException($status, $code, $message, $response->headers),
            default => new ApiException($status, $code, $message, $response->headers),
        };
    }

    private function decode(Response $response): mixed
    {
        try {
            return json_decode($response->body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new InvalidResponseException(
                sprintf('HTTP %d: the body is not JSON', $response->status),
                $response->status,
                $e,
            );
        }
    }

    private function tryDecode(string $body): mixed
    {
        try {
            return json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
    }
}
