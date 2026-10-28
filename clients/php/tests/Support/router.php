<?php

// Router script of `php -S` for FakeServer: records every request and replays the scripted answer.

declare(strict_types=1);

$dir = getenv('EET_FAKE_DIR');
if ($dir === false || $dir === '') {
    http_response_code(500);
    echo 'EET_FAKE_DIR not set';
    return true;
}

$headers = [];
foreach (getallheaders() as $name => $value) {
    $headers[strtolower($name)] = $value;
}
file_put_contents(
    $dir . '/requests.jsonl',
    json_encode([
        'method' => $_SERVER['REQUEST_METHOD'],
        'uri' => $_SERVER['REQUEST_URI'],
        'headers' => $headers,
        'body' => file_get_contents('php://input'),
    ]) . "\n",
    FILE_APPEND | LOCK_EX,
);

$answer = json_decode((string) file_get_contents($dir . '/answer.json'), true);
if (($answer['delay'] ?? 0) > 0) {
    usleep((int) round($answer['delay'] * 1_000_000));
}
foreach ($answer['headers'] as $name => $value) {
    header($name . ': ' . $value);
}
// After the headers: sending `Location` turns any non-201/3xx status into 302 (php -S), so the
// scripted status has to be set last.
http_response_code((int) $answer['status']);
echo $answer['body'];
return true;
