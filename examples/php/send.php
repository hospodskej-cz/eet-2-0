<?php
// Sends one sale to the EET Gateway HTTP API and waits for EET's answer.
// PHP 8.1+ with ext-curl, no Composer packages:
//   EET_URL=http://localhost:8080 EET_API_KEY=… php examples/php/send.php

declare(strict_types=1);

$url = getenv('EET_URL') ?: 'http://localhost:8080';
$key = getenv('EET_API_KEY') ?: exit("set EET_API_KEY\n");

/** @return array{int, array<string, mixed>} HTTP status and decoded JSON body */
function call(string $method, string $url, string $key, ?array $body = null, array $headers = []): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        // Sync submits wait for EET (up to the register's timeoutMs).
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => array_merge(
            ["Authorization: Bearer $key", 'Content-Type: application/json'],
            $headers,
        ),
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR),
    ]);
    $response = curl_exec($curl);
    if ($response === false) {
        throw new RuntimeException('EET Gateway unreachable: ' . curl_error($curl));
    }
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    return [$status, json_decode($response, true, flags: JSON_THROW_ON_ERROR)];
}

// Your own unique receipt id doubles as the idempotency key: repeating the request after a
// network error returns the stored result and never registers the sale twice.
$receipt = 'PHP-' . time();
$sale = [
    'porad_cis' => $receipt,
    'dat_trzby' => date('c'), // ISO 8601 with offset
    'celk_trzba' => '123.50', // eic_popl, id_jednotky, id_pokl come from the register config
];

[$status, $result] = call('POST', "$url/v1/sales", $key, $sale, ["Idempotency-Key: $receipt"]);

if ($status === 202) {
    // queued or uncertain: the gateway keeps resending; ask for the outcome.
    for ($i = 0; $i < 15 && in_array($result['status'], ['queued', 'uncertain'], true); $i++) {
        sleep(1);
        [, $result] = call('GET', "$url/v1/sales/{$result['id']}", $key);
    }
} elseif ($status === 409 || $status === 422) {
    // Invalid sale or idempotency key reused: nothing was sent.
    foreach ($result['issues'] as $issue) {
        fwrite(STDERR, "{$issue['code']} " . ($issue['field'] ?? '') . ": {$issue['message']}\n");
    }
    exit(1);
} elseif ($status !== 200) {
    fwrite(STDERR, "HTTP $status: " . json_encode($result) . "\n");
    exit(1);
}

printf("%s  %s  POK %s\n", $result['id'], $result['status'], $result['pok'] ?? '-');
foreach ($result['warnings'] as $warning) {
    printf("  warning %d (%s): %s\n", $warning['code'], $warning['source'], $warning['message']);
}
exit(in_array($result['status'], ['accepted', 'verification_ok'], true) ? 0 : 1);
