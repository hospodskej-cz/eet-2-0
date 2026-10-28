<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests;

use EetGateway\Client\Client;
use EetGateway\Client\Model\SaleInput;
use EetGateway\Client\Model\SaleStatus;
use EetGateway\Client\Model\SubmitMode;
use EetGateway\Client\Operations;
use EetGateway\Client\Tests\Support\MockTransport;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Drift guard: the client must cover everything docs/openapi.json describes.
 *
 * When the gateway gains an operation, a query parameter, a header or a response field, one of
 * these tests fails until the client (and the table below) catches up. scripts/gen-clients.ts does
 * the static half of the same check for all three languages.
 */
final class OpenApiCoverageTest extends TestCase
{
    private const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

    private const SALE = ['porad_cis' => 'R-1', 'dat_trzby' => '2027-01-05T12:00:00+01:00', 'celk_trzba' => '1.00'];

    /** @return array<string, mixed> */
    private static function spec(): array
    {
        $file = dirname(__DIR__, 3) . '/docs/openapi.json';
        return json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    }

    /** @return array<string, array{string, string, array<string, mixed>}> operationId => [method, path, operation] */
    private static function specOperations(): array
    {
        $operations = [];
        foreach (self::spec()['paths'] as $path => $item) {
            foreach ($item as $method => $operation) {
                if (in_array($method, self::HTTP_METHODS, true)) {
                    $operations[$operation['operationId']] = [strtoupper($method), $path, $operation];
                }
            }
        }
        return $operations;
    }

    /**
     * operationId => [client call using EVERY documented parameter, fake answer status, fake answer body].
     *
     * @return array<string, array{callable(Client): mixed, int, array<string, mixed>|string}>
     */
    private static function calls(): array
    {
        $emptyBatch = ['rows' => [], 'warnings' => [], 'issues' => []];
        $sale = ['status' => 'accepted', 'warnings' => [], 'attempts' => 1];
        return [
            'submitSale' => [
                static fn (Client $c) => $c->submitSale(self::SALE, idempotencyKey: 'k', mode: SubmitMode::Sync, verify: true, register: 'r'),
                200,
                $sale,
            ],
            'submitBatch' => [
                static fn (Client $c) => $c->submitBatch([self::SALE, new SaleInput('2027-01-05', '1.00')], idempotencyKey: 'k', mode: SubmitMode::Async, verify: true, register: 'r'),
                200,
                $emptyBatch,
            ],
            'getSale' => [static fn (Client $c) => $c->getSale('id-1'), 200, $sale],
            'getSaleAttempts' => [static fn (Client $c) => $c->getSaleAttempts('id-1'), 200, ['items' => []]],
            'retrySale' => [static fn (Client $c) => $c->retrySale('id-1'), 200, $sale],
            'listQueue' => [
                static fn (Client $c) => $c->listQueue(status: 'queued', register: 'r', from: '2027-01-01', to: '2027-02-01', overdue: true, limit: 5, cursor: 'c'),
                200,
                ['items' => []],
            ],
            'listRegisters' => [static fn (Client $c) => $c->listRegisters(), 200, ['items' => []]],
            'validateSales' => [
                static fn (Client $c) => $c->validateSales([self::SALE], verify: true, register: 'r'),
                200,
                $emptyBatch,
            ],
            'health' => [
                static fn (Client $c) => $c->health(checkEet: true),
                200,
                ['status' => 'ok', 'version' => '0', 'database' => 'ok'],
            ],
            'openapi' => [static fn (Client $c) => $c->getOpenApi(), 200, ['openapi' => '3.1.0']],
            'docs' => [static fn (Client $c) => $c->getDocs(), 200, '<html></html>'],
        ];
    }

    /** @return array<string, array{string}> */
    public static function operationIds(): array
    {
        $ids = [];
        foreach (array_keys(self::specOperations()) as $id) {
            $ids[$id] = [$id];
        }
        return $ids;
    }

    public function testEveryOpenapiOperationIsInTheClientTable(): void
    {
        $spec = [];
        foreach (self::specOperations() as $id => [$method, $path]) {
            $spec[$id] = [$method, $path];
        }
        self::assertEquals($spec, Operations::ALL);
    }

    public function testEveryOpenapiOperationHasACallInThisTest(): void
    {
        $spec = array_keys(self::specOperations());
        $calls = array_keys(self::calls());
        sort($spec);
        sort($calls);
        self::assertSame($spec, $calls, 'add the new operation to calls() (and the client)');
    }

    #[DataProvider('operationIds')]
    public function testOperationHitsTheDocumentedMethodPathAndParameters(string $operationId): void
    {
        [$method, $path, $operation] = self::specOperations()[$operationId];
        [$call, $status, $body] = self::calls()[$operationId];

        $transport = new MockTransport();
        $transport->respond($status, $body);
        $call(new Client('http://gateway.test', 'key', transport: $transport));
        $request = $transport->last();

        self::assertSame($method, $request->method);
        self::assertMatchesRegularExpression('#^' . preg_replace('#\{[^}]+\}#', '[^/]+', $path) . '$#', $request->path());

        $query = [];
        $headers = [];
        foreach ($operation['parameters'] ?? [] as $parameter) {
            if ($parameter['in'] === 'query') {
                $query[] = $parameter['name'];
            } elseif ($parameter['in'] === 'header') {
                $headers[] = $parameter['name'];
            }
        }
        $sent = array_keys($request->query());
        sort($query);
        sort($sent);
        self::assertSame($query, $sent);
        foreach ($headers as $header) {
            self::assertNotNull($request->header($header), "header $header not sent");
        }

        $secured = !empty($operation['security']);
        self::assertSame($secured, $request->header('Authorization') !== null);

        if (isset($operation['requestBody'])) {
            $mediaTypes = array_keys($operation['requestBody']['content']);
            self::assertContains((string) $request->header('Content-Type'), $mediaTypes);
        }
    }

    /**
     * @param mixed $node
     * @param array<string, true> $names
     */
    private static function collectProperties(mixed $node, array &$names): void
    {
        if (!is_array($node)) {
            return;
        }
        foreach ($node as $key => $value) {
            if ($key === 'properties' && is_array($value)) {
                foreach (array_keys($value) as $name) {
                    $names[(string) $name] = true;
                }
            }
            self::collectProperties($value, $names);
        }
    }

    public function testEverySchemaPropertyIsReadByTheModels(): void
    {
        $names = [];
        self::collectProperties(self::spec()['components']['schemas'], $names);
        unset($names['error']); // the error envelope is read by hand in Client::error()

        $source = '';
        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(dirname(__DIR__) . '/src', \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($files as $file) {
            if ($file->getExtension() === 'php') {
                $source .= (string) file_get_contents($file->getPathname());
            }
        }
        $missing = [];
        foreach (array_keys($names) as $name) {
            if (!str_contains($source, "'" . $name . "'")) {
                $missing[] = $name;
            }
        }
        sort($missing);
        self::assertSame([], $missing, 'models do not read: ' . implode(', ', $missing));
    }

    public function testSaleStatusesMatchTheSchema(): void
    {
        $declared = self::spec()['components']['schemas']['SaleResult']['properties']['status']['enum'];
        $known = array_values(array_filter(
            array_map(static fn (SaleStatus $s): string => $s->value, SaleStatus::cases()),
            static fn (string $v): bool => $v !== SaleStatus::Unknown->value,
        ));
        self::assertSame($declared, $known);
    }
}
