<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests;

use EetGateway\Client\Client;
use EetGateway\Client\Exception\NotFoundException;
use EetGateway\Client\Exception\UnauthorizedException;
use EetGateway\Client\Model\SaleStatus;
use PHPUnit\Framework\TestCase;

/**
 * Against the real gateway over a fake EET (no network, no certificates):
 *
 *     bun scripts/examples-server.ts 8080 &
 *     EET_URL=http://localhost:8080 EET_API_KEY=examples-key-0123456789 vendor/bin/phpunit tests/IntegrationTest.php
 *
 * Skipped without EET_URL. The first attempt of every sale "times out", the resend half a second
 * later is accepted (scripts/examples-server.ts), so this also walks the 202 -> polling path.
 */
final class IntegrationTest extends TestCase
{
    private Client $client;
    private string $url;

    protected function setUp(): void
    {
        $url = getenv('EET_URL');
        if ($url === false || $url === '') {
            self::markTestSkipped('set EET_URL to run against a gateway');
        }
        $this->url = $url;
        $this->client = new Client($url, getenv('EET_API_KEY') ?: 'examples-key-0123456789', timeout: 15.0);
    }

    /** @return array<string, mixed> */
    private static function sale(string $receipt): array
    {
        return ['porad_cis' => $receipt, 'dat_trzby' => date('c'), 'celk_trzba' => '123.50'];
    }

    private static function unique(string $prefix): string
    {
        return $prefix . '-' . (string) hrtime(true);
    }

    public function testSubmitWaitAndIdempotentReplay(): void
    {
        $receipt = self::unique('PHP');
        $sale = self::sale($receipt); // the same sale again, or the key counts as reused for another sale
        $first = $this->client->submitSale($sale, idempotencyKey: $receipt);
        self::assertNotNull($first->id);
        self::assertSame('/v1/sales/' . $first->id, $first->location);
        self::assertTrue($first->isPending()); // fake EET: first attempt times out

        $done = $this->client->waitForSale($first, timeout: 15.0, interval: 0.2);
        self::assertSame(SaleStatus::Accepted, $done->status);
        self::assertNotEmpty($done->pok);

        $again = $this->client->submitSale($sale, idempotencyKey: $receipt);
        self::assertSame($first->id, $again->id);
        self::assertTrue($again->replayed);

        $attempts = $this->client->getSaleAttempts($first->id);
        self::assertSame([true, false], array_map(static fn ($a) => $a->prvniZaslani, $attempts));
        self::assertSame('accepted', $attempts[count($attempts) - 1]->outcome);

        $seen = false;
        foreach ($this->client->iterateQueue(limit: 5) as $queued) {
            if ($queued->id === $first->id) {
                $seen = true;
                break;
            }
        }
        self::assertTrue($seen);
    }

    public function testVerificationModeAndInvalidSale(): void
    {
        $checked = $this->client->submitSale(self::sale(self::unique('V')), verify: true);
        $checked = $this->client->waitForSale($checked, timeout: 15.0, interval: 0.2);
        self::assertSame(SaleStatus::VerificationOk, $checked->status);
        self::assertTrue($checked->isSuccess());

        $invalid = $this->client->submitSale(['porad_cis' => 'X']);
        self::assertSame(SaleStatus::Invalid, $invalid->status);
        self::assertNotEmpty($invalid->issues);
        self::assertNull($invalid->id);
    }

    public function testBatchValidateAndSystemEndpoints(): void
    {
        $rows = [self::sale(self::unique('B1')), self::sale(self::unique('B2'))];
        $verdict = $this->client->validateSales($rows);
        self::assertTrue($verdict->isValid());
        self::assertCount(2, $verdict->rows);

        $batch = $this->client->submitBatch($rows, idempotencyKey: self::unique('batch'));
        self::assertSame([1, 2], array_map(static fn ($r) => $r->row, $batch->rows));
        foreach ($batch->rows as $row) {
            self::assertNotNull($row->result->id);
        }

        self::assertTrue($this->client->health()->isOk());
        self::assertStringStartsWith('3.1', $this->client->getOpenApi()['openapi']);
        self::assertStringContainsString('<', $this->client->getDocs());
        self::assertIsArray($this->client->listRegisters());
    }

    public function testErrors(): void
    {
        try {
            $this->client->getSale('does-not-exist');
            self::fail('expected NotFoundException');
        } catch (NotFoundException) {
            // expected
        }
        try {
            (new Client($this->url, 'wrong-key-0123456789'))->listQueue();
            self::fail('expected UnauthorizedException');
        } catch (UnauthorizedException) {
            // expected
        }
    }
}
