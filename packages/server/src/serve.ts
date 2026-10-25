/**
 * The Bun service: configuration file + environment → registers → SQLite queue → HTTP API.
 * Used by `bun packages/server/src/main.ts` (Docker) and later by `eet serve` (CLI).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createEetQueue, createSqliteStore } from "@eet-gateway/queue";
import { createApp } from "./app.ts";
import { ConfigError, parseConfig } from "./config.ts";
import { VERSION } from "./index.ts";
import { createLogger, type Logger, logQueueEvent } from "./log.ts";
import { expiryNotices, loadRegisters, registerStatus } from "./registers.ts";

const DAY_MS = 86_400_000;

export interface ServeOptions {
  /** Default: `EET_CONFIG`, then `./eet.config.yaml`. */
  readonly configPath?: string | undefined;
  /** Allow running without API keys (playground registers only). */
  readonly dev?: boolean | undefined;
  /** Overrides `server.port` (0 = any free port). */
  readonly port?: number | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly logger?: Logger | undefined;
}

export interface RunningServer {
  readonly url: URL;
  /** Stops accepting requests, waits for running attempts, closes the database. */
  stop(): Promise<void>;
}

/** Throws `ConfigError` for anything wrong in the configuration, certificates or passwords. */
export async function serve(options: ServeOptions = {}): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createLogger();
  const configPath = resolve(options.configPath ?? env["EET_CONFIG"] ?? "eet.config.yaml");

  const file = Bun.file(configPath);
  if (!(await file.exists()))
    throw new ConfigError([{ path: configPath, message: "konfigurační soubor nenalezen" }]);
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(await file.text());
  } catch (error) {
    throw new ConfigError([{ path: configPath, message: `YAML: ${(error as Error).message}` }]);
  }
  const config = parseConfig(raw, { env, baseDir: dirname(configPath), dev: options.dev === true });
  const registers = await loadRegisters(config.registers, { env });

  mkdirSync(dirname(config.database), { recursive: true });
  const db = new Database(config.database, { create: true });
  const queue = createEetQueue({
    store: createSqliteStore(db),
    registers: Object.fromEntries(
      registers.map((r) => [r.id, { transport: r.transport, context: r.context }]),
    ),
    retryUncertain: config.queue.retryUncertain,
    concurrency: config.queue.concurrency,
    pollIntervalMs: config.queue.pollIntervalMs,
    leaseMs: config.queue.leaseMs,
    retry: config.queue.retry,
    onEvent: (event) => logQueueEvent(logger, event),
  });
  const app = createApp({
    queue,
    apiKeys: config.apiKeys,
    dev: config.dev,
    registers: () => registers.map((r) => registerStatus(r, new Date())),
    endpoints: registers.map((r) => r.endpoint),
    ping: async () => {
      db.query("SELECT 1").get();
    },
    version: VERSION,
    onRequest: (entry) => logger.log("info", "request", { ...entry }),
    onError: (error) =>
      logger.log("error", "request failed", { detail: (error as Error)?.message ?? String(error) }),
  });

  const server = Bun.serve({
    hostname: config.server.host,
    port: options.port ?? config.server.port,
    fetch: app.fetch,
    // Sync submits wait for EET (timeoutMs, ≥ 2 s); Bun's default 10 s idle timeout is too short.
    idleTimeout: 120,
  });
  queue.start();

  const reportExpiry = () => {
    for (const notice of expiryNotices(registers, new Date()))
      logger.log(notice.level, "certificate", {
        register: notice.register,
        detail: notice.message,
      });
  };
  reportExpiry();
  const expiryTimer = setInterval(reportExpiry, DAY_MS);
  if (config.dev)
    logger.log("warn", "--dev: no API key needed on /v1; never expose this server", {
      apiKeys: config.apiKeys.length,
    });
  const url = new URL(server.url);
  logger.log("info", "listening", {
    url: url.href,
    version: VERSION,
    registers: registers.map((r) => `${r.id}:${r.environment}`).join(","),
    database: config.database,
  });

  let stopping: Promise<void> | undefined;
  return {
    url,
    stop() {
      stopping ??= (async () => {
        logger.log("info", "stopping");
        clearInterval(expiryTimer);
        await server.stop();
        await queue.stop();
        db.close();
        logger.log("info", "stopped");
      })();
      return stopping;
    },
  };
}
