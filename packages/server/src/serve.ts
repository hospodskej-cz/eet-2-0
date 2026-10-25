/**
 * The Bun service: configuration file + environment → registers → SQLite queue → HTTP API.
 * Used by `bun packages/server/src/main.ts` (Docker) and by the CLI (`eet serve` and, through
 * `openGateway`, the other commands).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createEetQueue, createSqliteStore, type EetQueue } from "@eet-gateway/queue";
import { createApp } from "./app.ts";
import { ConfigError, parseConfig, type ServerConfig } from "./config.ts";
import { VERSION } from "./index.ts";
import { createLogger, type Logger, logQueueEvent } from "./log.ts";
import { expiryNotices, type LoadedRegister, loadRegisters, registerStatus } from "./registers.ts";

const DAY_MS = 86_400_000;

export interface GatewayOptions {
  /** Default: `EET_CONFIG`, then `./eet.config.yaml`. */
  readonly configPath?: string | undefined;
  /** Allow running without API keys (playground registers only). */
  readonly dev?: boolean | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly logger?: Logger | undefined;
  /** `false` for command-line use: API keys and `--dev` do not apply. Default `true`. */
  readonly server?: boolean | undefined;
}

export interface Gateway {
  readonly config: ServerConfig;
  readonly registers: readonly LoadedRegister[];
  readonly queue: EetQueue;
  /** Throws when the queue database is not usable. */
  ping(): void;
  /** Stops the queue worker and waits for running attempts, then closes the database. */
  close(): Promise<void>;
}

/**
 * Configuration file + environment → registers with their certificates → SQLite queue. Shared
 * by the HTTP service and the CLI. Throws `ConfigError` for anything wrong in the
 * configuration, certificates or passwords. The queue worker is not started.
 */
export async function openGateway(options: GatewayOptions = {}): Promise<Gateway> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createLogger();
  const configPath = resolve(options.configPath || env["EET_CONFIG"] || "eet.config.yaml");
  const raw = await readConfigFile(configPath);
  const config = parseConfig(raw, {
    env,
    baseDir: dirname(configPath),
    dev: options.dev === true,
    server: options.server,
  });
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
  return {
    config,
    registers,
    queue,
    ping: () => {
      db.query("SELECT 1").get();
    },
    async close() {
      await queue.stop();
      db.close();
    },
  };
}

/** Reads and parses the YAML configuration; a missing or broken file is a `ConfigError`. */
export async function readConfigFile(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new ConfigError([{ path, message: "konfigurační soubor nenalezen" }]);
  try {
    return Bun.YAML.parse(await file.text());
  } catch (error) {
    throw new ConfigError([{ path, message: `YAML: ${(error as Error).message}` }]);
  }
}

export interface ServeOptions extends Omit<GatewayOptions, "server"> {
  /** Overrides `server.port` (0 = any free port). */
  readonly port?: number | undefined;
}

export interface RunningServer {
  readonly url: URL;
  /** Stops accepting requests, waits for running attempts, closes the database. */
  stop(): Promise<void>;
}

/** Throws `ConfigError` for anything wrong in the configuration, certificates or passwords. */
export async function serve(options: ServeOptions = {}): Promise<RunningServer> {
  const logger = options.logger ?? createLogger();
  const gateway = await openGateway({ ...options, logger });
  const { config, registers, queue } = gateway;
  const app = createApp({
    queue,
    apiKeys: config.apiKeys,
    dev: config.dev,
    registers: () => registers.map((r) => registerStatus(r, new Date())),
    endpoints: registers.map((r) => r.endpoint),
    ping: async () => gateway.ping(),
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
        await gateway.close();
        logger.log("info", "stopped");
      })();
      return stopping;
    },
  };
}

/**
 * Runs the service until SIGTERM or SIGINT, then stops it cleanly. Resolves with the exit code:
 * 0 after a clean stop, 1 if stopping failed or a second signal cut it short.
 */
export async function serveUntilSignal(options: ServeOptions = {}): Promise<number> {
  const server = await serve(options);
  return new Promise((done) => {
    let stopping = false;
    const onSignal = () => {
      if (stopping) return done(1);
      stopping = true;
      server.stop().then(
        () => done(0),
        () => done(1),
      );
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
  });
}
