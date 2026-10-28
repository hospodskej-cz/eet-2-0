<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests;

use EetGateway\Client\Client;
use EetGateway\Client\Exception\ApiException;
use EetGateway\Client\Exception\BadRequestException;
use EetGateway\Client\Exception\ConflictException;
use EetGateway\Client\Exception\IdempotencyConflictException;
use EetGateway\Client\Exception\InvalidResponseException;
use EetGateway\Client\Exception\NotFoundException;
use EetGateway\Client\Exception\PayloadTooLargeException;
use EetGateway\Client\Exception\ServerException;
use EetGateway\Client\Exception\TimeoutException;
use EetGateway\Client\Exception\TransportException;
use EetGateway\Client\Exception\UnauthorizedException;
use EetGateway\Client\Exception\UnprocessableException;
use EetGateway\Client\Exception\UnsupportedMediaTypeException;
use EetGateway\Client\Model\SaleInput;
use EetGateway\Client\Model\SaleStatus;
use EetGateway\Client\Model\SubmitMode;
use EetGateway\Client\Tests\Support\MockTransport;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ClientTest extends TestCase
{
    private const KEY = 'secret-key-0123456789';

    private const SALE = ['porad_cis' => 'R-1', 'dat_trzby' => '2027-01-05T12:00:00+01:00', 'celk_trzba' => '123.50'];

    private MockTransport $gateway;
    private Client $client;

    protected function setUp(): void
    {
        $this->gateway = new MockTransport();
        $this->client = new Client('http://gateway.test:8080', self::KEY, timeout: 5.0, transport: $this->gateway);
    }

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private static function saleBody(string $status = 'accepted', array $extra = []): array
    {
        $body = ['id' => 'sale-1', 'status' => $status, 'warnings' => [], 'attempts' => 1];
        if ($status === 'accepted') {
            $body['pok'] = 'A1B2-C3';
        }
        return $extra + $body;
    }

    // --- submitSale: 200 / 202 / 422 / 409 --------------------------------------------------

    public function testSubmitSaleAccepted(): void
    {
        $this->gateway->respond(200, self::saleBody(), ['Location' => '/v1/sales/sale-1']);
        $result = $this->client->submitSale(self::SALE, idempotencyKey: 'R-1');

        self::assertSame(SaleStatus::Accepted, $result->status);
        self::assertSame('A1B2-C3', $result->pok);
        self::assertTrue($result->isSuccess());
        self::assertTrue($result->isFinal());
        self::assertFalse($result->isPending());
        self::assertSame('/v1/sales/sale-1', $result->location);
        self::assertFalse($result->replayed);

        $request = $this->gateway->last();
        self::assertSame('POST', $request->method);
        self::assertSame('http://gateway.test:8080/v1/sales', $request->url);
        self::assertSame('Bearer ' . self::KEY, $request->header('Authorization'));
        self::assertSame('R-1', $request->header('Idempotency-Key'));
        self::assertSame('application/json', $request->header('Content-Type'));
        self::assertStringStartsWith('eet-gateway-client-php/', (string) $request->header('User-Agent'));
        self::assertSame(self::SALE, $request->json());
        self::assertSame([], $request->query());
        self::assertSame(5.0, $request->timeout);
    }

    public function testSubmitSaleQueryOptions(): void
    {
        $this->gateway->respond(200, self::saleBody('verification_ok'));
        $result = $this->client->submitSale(self::SALE, mode: SubmitMode::Async, verify: true, register: 'kasa-1');

        self::assertSame(SaleStatus::VerificationOk, $result->status);
        self::assertTrue($result->isSuccess());
        self::assertSame(['mode' => 'async', 'verify' => 'true', 'register' => 'kasa-1'], $this->gateway->last()->query());
        self::assertNull($this->gateway->last()->header('Idempotency-Key'));
    }

    public function testSubmitSaleModeAsString(): void
    {
        $this->gateway->respond(200, self::saleBody());
        $this->client->submitSale(self::SALE, mode: 'sync', verify: false);
        self::assertSame(['mode' => 'sync', 'verify' => 'false'], $this->gateway->last()->query());
    }

    public function testRejectedIsAResultNotAnError(): void
    {
        $this->gateway->respond(200, self::saleBody('rejected', ['code' => 4, 'message' => 'Neplatný podpis']));
        $result = $this->client->submitSale(self::SALE);

        self::assertSame(SaleStatus::Rejected, $result->status);
        self::assertSame(4, $result->code);
        self::assertSame('Neplatný podpis', $result->message);
        self::assertFalse($result->isSuccess());
        self::assertTrue($result->isFinal());
    }

    #[DataProvider('pendingStatuses')]
    public function testHttp202IsPending(string $status): void
    {
        $this->gateway->respond(
            202,
            self::saleBody($status, ['reason' => 'timeout', 'nextAttemptAt' => '2027-01-05T11:00:05Z']),
            ['Location' => '/v1/sales/sale-1', 'Idempotent-Replayed' => 'true'],
        );
        $result = $this->client->submitSale(self::SALE);

        self::assertTrue($result->isPending());
        self::assertFalse($result->isFinal());
        self::assertFalse($result->isSuccess());
        self::assertSame('timeout', $result->reason);
        self::assertSame('2027-01-05T11:00:05Z', $result->nextAttemptAt);
        self::assertTrue($result->replayed);
    }

    /** @return array<string, array{string}> */
    public static function pendingStatuses(): array
    {
        return ['queued' => ['queued'], 'uncertain' => ['uncertain']];
    }

    public function testHttp422InvalidReturnsIssues(): void
    {
        $this->gateway->respond(422, [
            'status' => 'invalid',
            'warnings' => [['code' => 101, 'message' => 'shifted', 'source' => 'ingest', 'field' => 'dat_trzby']],
            'attempts' => 0,
            'issues' => [['code' => 'missing_field', 'message' => 'celk_trzba chybí', 'field' => 'celk_trzba']],
        ]);
        $result = $this->client->submitSale(['porad_cis' => 'R-1']);

        self::assertSame(SaleStatus::Invalid, $result->status);
        self::assertNull($result->id);
        self::assertSame('missing_field', $result->issues[0]->code);
        self::assertSame('celk_trzba', $result->issues[0]->field);
        self::assertSame('ingest', $result->warnings[0]->source);
        self::assertSame('dat_trzby', $result->warnings[0]->field);
    }

    public function testHttp409IdempotencyConflict(): void
    {
        $this->gateway->respond(409, [
            'status' => 'invalid',
            'warnings' => [],
            'attempts' => 0,
            'issues' => [['code' => 'idempotency_conflict', 'message' => 'key used for another sale']],
        ]);
        try {
            $this->client->submitSale(self::SALE, idempotencyKey: 'R-1');
            self::fail('expected IdempotencyConflictException');
        } catch (IdempotencyConflictException $e) {
            self::assertInstanceOf(ConflictException::class, $e);
            self::assertInstanceOf(ApiException::class, $e);
            self::assertSame(409, $e->status);
            self::assertSame('idempotency_conflict', $e->errorCode);
            self::assertSame('idempotency_conflict', $e->result->issues[0]->code);
        }
    }

    public function testHttp422SingleSaleExpectedIsAnError(): void
    {
        $this->gateway->respond(422, ['error' => ['code' => 'single_sale_expected', 'message' => 'one sale only']]);
        try {
            $this->client->submitSale([self::SALE, self::SALE]);
            self::fail('expected UnprocessableException');
        } catch (UnprocessableException $e) {
            self::assertSame('single_sale_expected', $e->errorCode);
        }
    }

    public function testSaleInputDatesAmountsAndExtraFields(): void
    {
        $this->gateway->respond(200, self::saleBody());
        $sale = new SaleInput(
            datTrzby: new \DateTimeImmutable('2027-01-05 12:00:00', new \DateTimeZone('+01:00')),
            celkTrzba: 99.9,
            poradCis: 7,
            cerpZuct: 12.5,
            idJednotky: '11',
            extra: ['currency' => 'CZK'],
        );
        $this->client->submitSale($sale);

        self::assertEquals(
            [
                'id_jednotky' => '11',
                'porad_cis' => 7,
                'dat_trzby' => '2027-01-05T12:00:00+01:00',
                'celk_trzba' => '99.90',
                'cerp_zuct' => '12.50',
                'currency' => 'CZK',
            ],
            $this->gateway->last()->json(),
        );
    }

    public function testPlainArrayWithDateTimeIsNormalized(): void
    {
        $this->gateway->respond(200, self::saleBody());
        $this->client->submitSale([
            'dat_trzby' => new \DateTimeImmutable('2027-01-05 12:00:00', new \DateTimeZone('+01:00')),
            'celk_trzba' => 1.5,
            'note' => 'Čaj',
        ]);
        $sent = $this->gateway->last();
        self::assertStringContainsString('"note":"Čaj"', (string) $sent->body);
        self::assertSame('2027-01-05T12:00:00+01:00', $sent->json()['dat_trzby']);
        self::assertSame('1.50', $sent->json()['celk_trzba']);
    }

    public function testSubmitSaleRawXml(): void
    {
        $this->gateway->respond(200, self::saleBody());
        $this->client->submitSaleRaw("<Data celk_trzba='1.00'/>", 'application/xml', 'x');
        self::assertSame('application/xml', $this->gateway->last()->header('Content-Type'));
        self::assertSame("<Data celk_trzba='1.00'/>", $this->gateway->last()->body);
    }

    /** @return array<string, array{string}> */
    public static function badKeys(): array
    {
        return [
            'empty' => [''],
            'too long' => [str_repeat('a', 256)],
            'newline' => ["line\nbreak"],
            'trailing newline' => ["abc\n"],
            'non ascii' => ['žluťoučký'],
        ];
    }

    #[DataProvider('badKeys')]
    public function testInvalidIdempotencyKeyIsRejectedBeforeSending(string $key): void
    {
        try {
            $this->client->submitSale(self::SALE, idempotencyKey: $key);
            self::fail('expected InvalidArgumentException');
        } catch (\InvalidArgumentException) {
            self::assertSame([], $this->gateway->requests);
        }
    }

    // --- parsed models ----------------------------------------------------------------------

    public function testSaleResultFullModelIgnoresUnknownFields(): void
    {
        $this->gateway->respond(200, self::saleBody('accepted', [
            'register' => 'kasa-1',
            'uuid' => 'u-1',
            'test' => true,
            'overdue' => false,
            'createdAt' => '2027-01-05T11:00:00Z',
            'deadlineAt' => '2027-01-07T11:00:00Z',
            'httpStatus' => 200,
            'globalTransactionId' => 'g-1',
            'data' => [
                'eic_popl' => 'CZ00000019',
                'id_jednotky' => '11',
                'id_pokl' => 'KASA-1',
                'porad_cis' => 'R-1',
                'dat_trzby' => '2027-01-05T12:00:00+01:00',
                'celk_trzba' => '123.50',
            ],
            'warnings' => [['code' => 5, 'message' => 'm', 'source' => 'eet']],
            'futureField' => 'ignored',
        ]));
        $result = $this->client->getSale('sale-1');

        self::assertNotNull($result->data);
        self::assertSame('123.50', $result->data->celkTrzba);
        self::assertSame('CZ00000019', $result->data->eicPopl);
        self::assertSame('kasa-1', $result->register);
        self::assertSame('u-1', $result->uuid);
        self::assertTrue($result->test);
        self::assertFalse($result->overdue);
        self::assertSame(200, $result->httpStatus);
        self::assertSame('g-1', $result->globalTransactionId);
        self::assertSame('eet', $result->warnings[0]->source);
    }

    public function testUnknownStatusReadsAsUnknown(): void
    {
        $this->gateway->respond(200, self::saleBody('brand_new'));
        $result = $this->client->getSale('sale-1');
        self::assertSame(SaleStatus::Unknown, $result->status);
        self::assertFalse($result->isSuccess());
        self::assertTrue($result->isFinal());
    }

    // --- other operations -------------------------------------------------------------------

    public function testSubmitBatch(): void
    {
        $this->gateway->respond(200, [
            'rows' => [
                ['row' => 1, 'result' => self::saleBody('queued')],
                ['row' => 2, 'result' => ['status' => 'invalid', 'warnings' => [], 'attempts' => 0, 'issues' => [['code' => 'c', 'message' => 'm']]]],
            ],
            'warnings' => [],
            'issues' => [],
        ]);
        $result = $this->client->submitBatch([self::SALE, new SaleInput('2027-01-05T12:00:00+01:00', '1.00')], idempotencyKey: 'batch-1', mode: SubmitMode::Sync);

        self::assertSame([1, 2], array_map(static fn ($r) => $r->row, $result->rows));
        self::assertTrue($result->rows[0]->result->isPending());
        self::assertSame(SaleStatus::Invalid, $result->rows[1]->result->status);
        $request = $this->gateway->last();
        self::assertSame('POST', $request->method);
        self::assertSame('/v1/sales/batch', $request->path());
        self::assertCount(2, $request->json());
        self::assertSame('batch-1', $request->header('Idempotency-Key'));
        self::assertSame(['mode' => 'sync'], $request->query());
    }

    public function testSubmitBatchUnreadableSource422(): void
    {
        $this->gateway->respond(422, ['rows' => [], 'warnings' => [], 'issues' => [['code' => 'bad_json', 'message' => 'not JSON']]]);
        $result = $this->client->submitBatchRaw('{{', 'application/json');
        self::assertSame([], $result->rows);
        self::assertSame('bad_json', $result->issues[0]->code);
    }

    public function testSubmitBatchRawCsv(): void
    {
        $this->gateway->respond(200, ['rows' => [], 'warnings' => [], 'issues' => []]);
        $this->client->submitBatchRaw("dat_trzby;celk_trzba\n2027-01-05;1,00\n", 'text/csv');
        self::assertSame('text/csv', $this->gateway->last()->header('Content-Type'));
    }

    public function testGetSalePathIsEscaped(): void
    {
        $this->gateway->respond(200, self::saleBody());
        $this->client->getSale('a/b c');
        self::assertSame('/v1/sales/a%2Fb%20c', $this->gateway->last()->path());
    }

    public function testGetSaleAttempts(): void
    {
        $this->gateway->respond(200, ['items' => [
            [
                'n' => 1, 'uuid_zpravy' => 'u-1', 'dat_odesl' => '2027-01-05T12:00:01+01:00', 'prvni_zaslani' => true,
                'overeni' => false, 'environment' => 'playground', 'endpoint' => 'https://pg.example/eet',
                'startedAt' => '2027-01-05T11:00:01Z', 'outcome' => 'uncertain', 'reason' => 'timeout', 'durationMs' => 10000,
            ],
            [
                'n' => 2, 'uuid_zpravy' => 'u-2', 'dat_odesl' => '2027-01-05T12:00:20+01:00', 'prvni_zaslani' => false,
                'overeni' => false, 'environment' => 'playground', 'endpoint' => 'https://pg.example/eet',
                'startedAt' => '2027-01-05T11:00:20Z', 'finishedAt' => '2027-01-05T11:00:21Z', 'outcome' => 'accepted',
                'pok' => 'A1B2-C3', 'httpStatus' => 200,
            ],
        ]]);
        $attempts = $this->client->getSaleAttempts('sale-1');

        self::assertSame('/v1/sales/sale-1/attempts', $this->gateway->last()->path());
        self::assertSame([1, 2], array_map(static fn ($a) => $a->n, $attempts));
        self::assertNull($attempts[0]->finishedAt);
        self::assertSame(10000, $attempts[0]->durationMs);
        self::assertSame('accepted', $attempts[1]->outcome);
        self::assertSame('A1B2-C3', $attempts[1]->pok);
        self::assertFalse($attempts[1]->prvniZaslani);
    }

    public function testRetrySale(): void
    {
        $this->gateway->respond(202, self::saleBody('queued'));
        $result = $this->client->retrySale('sale-1');
        self::assertSame('POST', $this->gateway->last()->method);
        self::assertSame('/v1/sales/sale-1/retry', $this->gateway->last()->path());
        self::assertTrue($result->isPending());
    }

    public function testRetrySaleNotRetryable(): void
    {
        $this->gateway->respond(409, ['error' => ['code' => 'not_retryable', 'message' => 'final']]);
        try {
            $this->client->retrySale('sale-1');
            self::fail('expected ConflictException');
        } catch (ConflictException $e) {
            self::assertNotInstanceOf(IdempotencyConflictException::class, $e);
            self::assertSame('not_retryable', $e->errorCode);
        }
    }

    public function testListQueueFilters(): void
    {
        $this->gateway->respond(200, ['items' => [self::saleBody('queued')], 'nextCursor' => 'c2']);
        $page = $this->client->listQueue(
            status: [SaleStatus::Queued, 'uncertain'],
            register: 'kasa-1',
            from: new \DateTimeImmutable('2027-01-01 00:00:00', new \DateTimeZone('UTC')),
            to: '2027-02-01T00:00:00Z',
            overdue: false,
            limit: 20,
            cursor: 'c1',
        );

        self::assertSame('c2', $page->nextCursor);
        self::assertTrue($page->items[0]->isPending());
        self::assertSame(
            [
                'status' => 'queued,uncertain',
                'register' => 'kasa-1',
                'from' => '2027-01-01T00:00:00+00:00',
                'to' => '2027-02-01T00:00:00Z',
                'overdue' => 'false',
                'limit' => '20',
                'cursor' => 'c1',
            ],
            $this->gateway->last()->query(),
        );
    }

    public function testListQueueSingleStatusAndNoFilters(): void
    {
        $this->gateway->respond(200, ['items' => []]);
        $this->client->listQueue(status: SaleStatus::Rejected);
        self::assertSame(['status' => 'rejected'], $this->gateway->last()->query());
        $this->client->listQueue();
        self::assertSame([], $this->gateway->last()->query());
    }

    public function testIterateQueueFollowsCursors(): void
    {
        $this->gateway->respond(200, ['items' => [self::saleBody('accepted', ['id' => 'a']), self::saleBody('accepted', ['id' => 'b'])], 'nextCursor' => 'p2']);
        $this->gateway->respond(200, ['items' => [self::saleBody('accepted', ['id' => 'c'])]]);
        $ids = [];
        foreach ($this->client->iterateQueue(limit: 2) as $sale) {
            $ids[] = $sale->id;
        }

        self::assertSame(['a', 'b', 'c'], $ids);
        self::assertArrayNotHasKey('cursor', $this->gateway->requests[0]->query());
        self::assertSame('p2', $this->gateway->requests[1]->query()['cursor']);
        self::assertSame('2', $this->gateway->requests[1]->query()['limit']);
    }

    public function testListRegisters(): void
    {
        $this->gateway->respond(200, ['items' => [[
            'id' => 'kasa-1',
            'environment' => 'playground',
            'endpoint' => 'https://pg.example/eet',
            'defaults' => ['eic_popl' => 'CZ00000019', 'id_jednotky' => '11'],
            'timeZone' => 'Europe/Prague',
            'certificates' => [[
                'eic' => 'CZ00000019', 'subject' => 'CN=x', 'issuer' => 'CN=I.CA', 'serialNumber' => '01',
                'fingerprintSha256' => 'ab', 'notBefore' => '2026-01-01T00:00:00Z', 'notAfter' => '2027-01-20T00:00:00Z',
                'daysLeft' => 15, 'active' => true, 'expiresSoon' => true, 'expired' => false,
            ]],
        ]]]);
        $registers = $this->client->listRegisters();

        self::assertCount(1, $registers);
        self::assertSame('kasa-1', $registers[0]->id);
        self::assertSame('Europe/Prague', $registers[0]->timeZone);
        self::assertSame('11', $registers[0]->defaults['id_jednotky']);
        $cert = $registers[0]->certificates[0];
        self::assertSame(15, $cert->daysLeft);
        self::assertTrue($cert->expiresSoon);
        self::assertTrue($cert->active);
        self::assertFalse($cert->expired);
        self::assertSame('ab', $cert->fingerprintSha256);
        self::assertSame('01', $cert->serialNumber);
    }

    public function testValidateSales(): void
    {
        $this->gateway->respond(200, [
            'rows' => [
                ['row' => 1, 'result' => ['valid' => true, 'warnings' => [], 'issues' => [], 'overeni' => false]],
                ['row' => 2, 'result' => ['valid' => false, 'warnings' => [], 'issues' => [['code' => 'missing_field', 'message' => 'm', 'field' => 'celk_trzba']]]],
            ],
            'warnings' => [],
            'issues' => [],
        ]);
        $batch = $this->client->validateSales([self::SALE, ['porad_cis' => 'x']], verify: true, register: 'kasa-1');

        self::assertSame('POST', $this->gateway->last()->method);
        self::assertSame('/v1/validate', $this->gateway->last()->path());
        self::assertSame(['verify' => 'true', 'register' => 'kasa-1'], $this->gateway->last()->query());
        self::assertTrue($batch->rows[0]->result->valid);
        self::assertFalse($batch->rows[1]->result->valid);
        self::assertFalse($batch->isValid());
        self::assertSame('celk_trzba', $batch->rows[1]->result->issues[0]->field);
    }

    public function testValidateSalesRawUnreadable422(): void
    {
        $this->gateway->respond(422, ['rows' => [], 'warnings' => [], 'issues' => [['code' => 'bad_csv', 'message' => 'm']]]);
        $batch = $this->client->validateSalesRaw("\xff", 'text/csv');
        self::assertSame('bad_csv', $batch->issues[0]->code);
        self::assertFalse($batch->isValid());
    }

    public function testHealthIsPublicAnd503IsReturned(): void
    {
        $this->gateway->respond(503, [
            'status' => 'degraded',
            'version' => '0.1.0',
            'database' => 'ok',
            'eet' => [['endpoint' => 'https://e', 'reachable' => false, 'durationMs' => 12.5, 'checkedAt' => 't', 'error' => 'dns']],
        ]);
        $health = $this->client->health(checkEet: true);

        self::assertFalse($health->isOk());
        self::assertSame('ok', $health->database);
        self::assertNotNull($health->eet);
        self::assertSame('dns', $health->eet[0]->error);
        self::assertFalse($health->eet[0]->reachable);
        self::assertSame(12.5, $health->eet[0]->durationMs);
        self::assertSame('/health', $this->gateway->last()->path());
        self::assertSame(['eet' => 'true'], $this->gateway->last()->query());
        self::assertNull($this->gateway->last()->header('Authorization'));
    }

    public function testGetOpenApiAndDocs(): void
    {
        $this->gateway->respond(200, ['openapi' => '3.1.0']);
        self::assertSame('3.1.0', $this->client->getOpenApi()['openapi']);
        self::assertSame('/openapi.json', $this->gateway->last()->path());
        self::assertNull($this->gateway->last()->header('Authorization'));
        $this->gateway->respond(200, '<html>docs</html>');
        self::assertSame('<html>docs</html>', $this->client->getDocs());
        self::assertSame('/docs', $this->gateway->last()->path());
    }

    // --- waitForSale ------------------------------------------------------------------------

    public function testWaitForSalePollsUntilFinal(): void
    {
        $this->gateway->respond(200, self::saleBody('uncertain'));
        $this->gateway->respond(200, self::saleBody('queued'));
        $this->gateway->respond(200, self::saleBody('accepted'));
        $result = $this->client->waitForSale('sale-1', interval: 0.01);

        self::assertSame(SaleStatus::Accepted, $result->status);
        self::assertCount(3, $this->gateway->requests);
        foreach ($this->gateway->requests as $request) {
            self::assertSame('/v1/sales/sale-1', $request->path());
        }
    }

    public function testWaitForSaleSkipsAFinalResult(): void
    {
        $this->gateway->respond(200, self::saleBody('accepted'));
        $final = $this->client->getSale('sale-1');
        self::assertSame($final, $this->client->waitForSale($final));
        self::assertCount(1, $this->gateway->requests);
    }

    public function testWaitForSaleGivesUpWithTheLastState(): void
    {
        $this->gateway->respond(202, self::saleBody('queued'));
        $this->gateway->respond(200, self::saleBody('queued'));
        $pending = $this->client->submitSale(self::SALE);
        $result = $this->client->waitForSale($pending, timeout: 0.05, interval: 0.01);
        self::assertTrue($result->isPending());
    }

    // --- errors -----------------------------------------------------------------------------

    /** @return array<string, array{int, string, class-string<ApiException>}> */
    public static function errorStatuses(): array
    {
        return [
            '400' => [400, 'bad_request', BadRequestException::class],
            '401' => [401, 'unauthorized', UnauthorizedException::class],
            '404' => [404, 'not_found', NotFoundException::class],
            '413' => [413, 'payload_too_large', PayloadTooLargeException::class],
            '415' => [415, 'unsupported_media_type', UnsupportedMediaTypeException::class],
            '500' => [500, 'internal', ServerException::class],
        ];
    }

    #[DataProvider('errorStatuses')]
    public function testErrorStatusesMapToExceptions(int $status, string $code, string $class): void
    {
        $this->gateway->respond($status, ['error' => ['code' => $code, 'message' => 'boom']]);
        try {
            $this->client->getSale('x');
            self::fail('expected ' . $class);
        } catch (ApiException $e) {
            self::assertInstanceOf($class, $e);
            self::assertSame($status, $e->status);
            self::assertSame($code, $e->errorCode);
            self::assertSame('boom', $e->errorMessage);
        }
    }

    public function testErrorCarriesHeaders(): void
    {
        $this->gateway->respond(401, ['error' => ['code' => 'unauthorized', 'message' => 'no']], ['WWW-Authenticate' => 'Bearer realm="eet-gateway"']);
        try {
            $this->client->listRegisters();
            self::fail('expected UnauthorizedException');
        } catch (UnauthorizedException $e) {
            self::assertStringStartsWith('Bearer', $e->headers['www-authenticate']);
        }
    }

    public function testNonJsonErrorBody(): void
    {
        $this->gateway->respond(502, '<html>Bad Gateway</html>');
        try {
            $this->client->getSale('x');
            self::fail('expected ServerException');
        } catch (ServerException $e) {
            self::assertSame(502, $e->status);
            self::assertStringContainsString('Bad Gateway', $e->errorMessage);
        }
    }

    public function testSuccessWithNonJsonBody(): void
    {
        $this->gateway->respond(200, 'not json');
        $this->expectException(InvalidResponseException::class);
        $this->client->getSale('x');
    }

    public function testRedirectIsAnError(): void
    {
        $this->gateway->respond(301, '', ['Location' => 'http://elsewhere.invalid/']);
        try {
            $this->client->submitSale(self::SALE);
            self::fail('expected ApiException');
        } catch (ApiException $e) {
            self::assertSame(301, $e->status);
        }
    }

    public function testTransportFailuresPassThrough(): void
    {
        $this->gateway->fail(new TimeoutException('timed out'));
        try {
            $this->client->getSale('x');
            self::fail('expected TimeoutException');
        } catch (TimeoutException $e) {
            self::assertInstanceOf(TransportException::class, $e);
        }
    }

    public function testBaseUrlValidationAndPathPrefix(): void
    {
        try {
            new Client('localhost:8080');
            self::fail('expected InvalidArgumentException');
        } catch (\InvalidArgumentException) {
            // expected
        }
        $this->gateway->respond(200, self::saleBody());
        (new Client('http://gateway.test/eet/', 'k', transport: $this->gateway))->getSale('a');
        self::assertSame('http://gateway.test/eet/v1/sales/a', $this->gateway->last()->url);
    }

    public function testNoApiKeySendsNoAuthorization(): void
    {
        $this->gateway->respond(200, ['items' => []]);
        (new Client('http://gateway.test', transport: $this->gateway))->listRegisters();
        self::assertNull($this->gateway->last()->header('Authorization'));
    }

    public function testSaleStatusWireValues(): void
    {
        self::assertSame('verification_ok', SaleStatus::VerificationOk->value);
        self::assertSame(SaleStatus::Unknown, SaleStatus::fromWire('whatever'));
        self::assertSame(SaleStatus::Unknown, SaleStatus::fromWire(null));
        self::assertSame(SaleStatus::Queued, SaleStatus::fromWire('queued'));
    }
}
