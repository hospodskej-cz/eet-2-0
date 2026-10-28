<?php

declare(strict_types=1);

namespace EetGateway\Client;

/**
 * Every operation of docs/openapi.json: operationId => [HTTP method, path]. The client sends its
 * requests through this table, and scripts/gen-clients.ts fails CI when it falls behind the
 * OpenAPI document.
 */
final class Operations
{
    public const ALL = [
        'submitSale' => ['POST', '/v1/sales'],
        'submitBatch' => ['POST', '/v1/sales/batch'],
        'getSale' => ['GET', '/v1/sales/{id}'],
        'getSaleAttempts' => ['GET', '/v1/sales/{id}/attempts'],
        'retrySale' => ['POST', '/v1/sales/{id}/retry'],
        'listQueue' => ['GET', '/v1/queue'],
        'listRegisters' => ['GET', '/v1/registers'],
        'validateSales' => ['POST', '/v1/validate'],
        'health' => ['GET', '/health'],
        'openapi' => ['GET', '/openapi.json'],
        'docs' => ['GET', '/docs'],
    ];
}
