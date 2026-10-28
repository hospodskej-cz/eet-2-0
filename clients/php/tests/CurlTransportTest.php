<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests;

use EetGateway\Client\Client;
use EetGateway\Client\Exception\ApiException;
use EetGateway\Client\Exception\NotFoundException;
use EetGateway\Client\Exception\TimeoutException;
use EetGateway\Client\Exception\TransportException;
use EetGateway\Client\Http\CurlTransport;
use EetGateway\Client\Model\SaleStatus;
use EetGateway\Client\Tests\Support\FakeServer;
use PHPUnit\Framework\TestCase;

/** The default transport and the client over a real socket (`php -S` as the fake gateway). */
final class CurlTransportTest extends TestCase
{
    private FakeServer $server;

    protected function setUp(): void
    {
        $this->server = new FakeServer();
    }

    protected function tearDown(): void
    {
        $this->server->stop();
    }

    public function testClientRoundTripOverHttp(): void
    {
        $this->server->respond(
            202,
            '{"id":"sale-1","status":"queued","warnings":[],"attempts":0}',
            ['Content-Type' => 'application/json', 'Location' => '/v1/sales/sale-1', 'Idempotent-Replayed' => 'true'],
        );
        $client = new Client($this->server->url, 'secret-key-0123456789', timeout: 5.0);
        $result = $client->submitSale(
            ['porad_cis' => 'R-1', 'dat_trzby' => '2027-01-05T12:00:00+01:00', 'celk_trzba' => '123.50'],
            idempotencyKey: 'R-1',
            verify: true,
        );

        self::assertSame(SaleStatus::Queued, $result->status);
        self::assertSame('/v1/sales/sale-1', $result->location);
        self::assertTrue($result->replayed);

        $requests = $this->server->requests();
        self::assertCount(1, $requests);
        self::assertSame('POST', $requests[0]['method']);
        self::assertSame('/v1/sales?verify=true', $requests[0]['uri']);
        self::assertSame('Bearer secret-key-0123456789', $requests[0]['headers']['authorization']);
        self::assertSame('R-1', $requests[0]['headers']['idempotency-key']);
        self::assertSame('application/json', $requests[0]['headers']['content-type']);
        self::assertSame('R-1', json_decode($requests[0]['body'], true)['porad_cis']);
    }

    public function testGetHasNoBodyAndErrorStatusIsReturnedAsResponse(): void
    {
        $this->server->respond(404, '{"error":{"code":"not_found","message":"no such record"}}', ['Content-Type' => 'application/json']);
        $client = new Client($this->server->url, 'k', timeout: 5.0);

        try {
            $client->getSale('missing');
            self::fail('expected NotFoundException');
        } catch (NotFoundException $e) {
            self::assertSame('not_found', $e->errorCode);
            self::assertSame('no such record', $e->errorMessage);
        }
        $requests = $this->server->requests();
        self::assertSame('GET', $requests[0]['method']);
        self::assertSame('/v1/sales/missing', $requests[0]['uri']);
        self::assertSame('', $requests[0]['body']);
    }

    public function testPostWithoutBodyIsSent(): void
    {
        $this->server->respond(200, '{"id":"sale-1","status":"accepted","warnings":[],"attempts":2}', ['Content-Type' => 'application/json']);
        $client = new Client($this->server->url, 'k', timeout: 5.0);
        $result = $client->retrySale('sale-1');

        self::assertSame(SaleStatus::Accepted, $result->status);
        $requests = $this->server->requests();
        self::assertSame('POST', $requests[0]['method']);
        self::assertSame('/v1/sales/sale-1/retry', $requests[0]['uri']);
    }

    public function testTransportReturnsHeadersLowerCased(): void
    {
        $this->server->respond(200, 'ok', ['X-Custom-Header' => 'Value: with colon']);
        $response = (new CurlTransport())->send('GET', $this->server->url . '/anything', ['Accept' => '*/*'], null, 5.0, 5.0);

        self::assertSame(200, $response->status);
        self::assertSame('ok', $response->body);
        self::assertSame('Value: with colon', $response->header('X-Custom-Header'));
    }

    public function testRedirectsAreNotFollowed(): void
    {
        $this->server->respond(302, '', ['Location' => 'http://127.0.0.1:1/never']);
        $client = new Client($this->server->url, 'k', timeout: 5.0);

        try {
            $client->getSale('x');
            self::fail('expected ApiException');
        } catch (ApiException $e) {
            self::assertSame(302, $e->status);
        }
        self::assertCount(1, $this->server->requests());
    }

    public function testSlowGatewayTimesOut(): void
    {
        $this->server->respond(200, '{}', [], 2.0);
        $client = new Client($this->server->url, 'k', timeout: 0.3);

        $this->expectException(TimeoutException::class);
        $client->getSale('x');
    }

    public function testConnectionRefused(): void
    {
        $probe = stream_socket_server('tcp://127.0.0.1:0');
        self::assertNotFalse($probe);
        $name = (string) stream_socket_get_name($probe, false);
        fclose($probe);
        $port = (int) substr($name, (int) strrpos($name, ':') + 1);

        $client = new Client('http://127.0.0.1:' . $port, 'k', timeout: 5.0);
        try {
            $client->health();
            self::fail('expected TransportException');
        } catch (TransportException $e) {
            self::assertNotInstanceOf(TimeoutException::class, $e);
        }
    }
}
