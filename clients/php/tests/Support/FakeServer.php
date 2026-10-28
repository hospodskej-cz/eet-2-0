<?php

declare(strict_types=1);

namespace EetGateway\Client\Tests\Support;

/**
 * A real HTTP server on 127.0.0.1 (`php -S` with router.php) that replays one scripted answer and
 * records the requests, so CurlTransport is tested over an actual socket.
 */
final class FakeServer
{
    public readonly string $url;

    private string $dir;

    /** @var resource|null */
    private $process;

    public function __construct()
    {
        $probe = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        if ($probe === false) {
            throw new \RuntimeException('no free port: ' . $error);
        }
        $name = (string) stream_socket_get_name($probe, false);
        $port = (int) substr($name, (int) strrpos($name, ':') + 1);
        fclose($probe);

        $this->dir = sys_get_temp_dir() . '/eet-fake-' . bin2hex(random_bytes(6));
        mkdir($this->dir);
        $this->respond(200, '');

        $env = getenv();
        $env['EET_FAKE_DIR'] = $this->dir;
        $process = proc_open(
            [PHP_BINARY, '-S', '127.0.0.1:' . $port, __DIR__ . '/router.php'],
            [0 => ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'r'], 1 => ['file', $this->dir . '/server.log', 'w'], 2 => ['file', $this->dir . '/server.log', 'a']],
            $pipes,
            null,
            $env,
        );
        if ($process === false) {
            throw new \RuntimeException('cannot start php -S');
        }
        $this->process = $process;
        $this->url = 'http://127.0.0.1:' . $port;

        for ($i = 0; $i < 100; $i++) {
            $socket = @fsockopen('127.0.0.1', $port, $errno, $error, 0.1);
            if ($socket !== false) {
                fclose($socket);
                return;
            }
            usleep(50_000);
        }
        $this->stop();
        throw new \RuntimeException('php -S did not start: ' . (string) @file_get_contents($this->dir . '/server.log'));
    }

    /**
     * @param array<string, string> $headers
     */
    public function respond(int $status, string $body, array $headers = [], float $delay = 0.0): void
    {
        file_put_contents(
            $this->dir . '/answer.json',
            json_encode(['status' => $status, 'body' => $body, 'headers' => $headers, 'delay' => $delay], JSON_THROW_ON_ERROR),
        );
    }

    /** @return list<array{method: string, uri: string, headers: array<string, string>, body: string}> */
    public function requests(): array
    {
        $file = $this->dir . '/requests.jsonl';
        if (!is_file($file)) {
            return [];
        }
        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        return array_map(static fn (string $line): array => json_decode($line, true, 512, JSON_THROW_ON_ERROR), $lines === false ? [] : $lines);
    }

    public function stop(): void
    {
        if ($this->process !== null) {
            proc_terminate($this->process);
            proc_close($this->process);
            $this->process = null;
        }
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }
}
