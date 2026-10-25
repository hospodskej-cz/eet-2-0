/**
 * Server configuration: `eet.config.yaml` overridden by `EET_*` environment variables, checked
 * with zod. `parseConfig` does no I/O; secrets never enter the result — a certificate carries
 * only where its password comes from (a file path or the name of an environment variable).
 * Reference: docs/SERVER.md.
 */

import { isAbsolute, resolve } from "node:path";
import { DEFAULT_TIME_ZONE, EET_PLAYGROUND_ENDPOINT, type EetEnvironment } from "@eet-gateway/core";
import {
  DATA_FIELDS,
  type FieldMap,
  OPTION_FIELDS,
  type RegisterDefaults,
} from "@eet-gateway/ingest";
import { z } from "zod";

export interface ConfigIssue {
  /** Dotted path in the configuration, or the environment variable. */
  readonly path: string;
  readonly message: string;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Chyba konfigurace:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.issues = issues;
  }
}

const CANONICAL_FIELDS = new Set<string>([...DATA_FIELDS, ...OPTION_FIELDS]);
const httpsUrl = z.url({ protocol: /^https$/, error: "musí být https:// URL" });
const text = z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1));

const CertificateSchema = z.strictObject({
  p12: z.string().min(1),
  passwordFile: z.string().min(1).optional(),
});

const RegisterSchema = z.strictObject({
  environment: z.enum(["playground", "production"]),
  certificates: z.array(CertificateSchema).min(1).optional(),
  defaults: z
    .strictObject({
      eic_popl: text.optional(),
      id_jednotky: text.optional(),
      id_pokl: text.optional(),
    })
    .optional(),
  endpoint: httpsUrl.optional(),
  timeoutMs: z.int().min(2_000).optional(),
  timeZone: z.string().optional(),
  fieldMap: z.record(z.string(), z.string()).optional(),
  debug: z.boolean().default(false),
});

const FileSchema = z.strictObject({
  server: z
    .strictObject({
      host: z.string().min(1).default("0.0.0.0"),
      port: z.coerce.number().int().min(0).max(65_535).default(8080),
    })
    .default({ host: "0.0.0.0", port: 8080 }),
  apiKeys: z.array(z.string().min(16, "API klíč musí mít aspoň 16 znaků")).default([]),
  database: z.string().min(1).default("./eet-queue.db"),
  timeZone: z.string().default(DEFAULT_TIME_ZONE),
  productionEndpoint: httpsUrl.optional(),
  queue: z
    .strictObject({
      retryUncertain: z.boolean().optional(),
      concurrency: z.int().min(1).optional(),
      pollIntervalMs: z.int().min(100).optional(),
      leaseMs: z.int().min(4_000).optional(),
      retry: z
        .strictObject({
          initialDelayMs: z.int().min(1).optional(),
          maxDelayMs: z.int().min(1).optional(),
          code8Attempts: z.int().min(1).optional(),
        })
        .optional(),
    })
    .default({}),
  registers: z
    .record(
      z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, "id pokladny: písmena, číslice, _ . -"),
      RegisterSchema,
    )
    .refine((registers) => Object.keys(registers).length > 0, "nakonfiguruj aspoň jednu pokladnu"),
});

export interface CertificateConfig {
  /** Absolute path of the `.p12`. */
  readonly p12: string;
  /** Absolute path of a file holding the password, if configured. */
  readonly passwordFile?: string | undefined;
  /** Environment variable with the password, used when there is no `passwordFile`. */
  readonly passwordEnv: string;
}

export interface RegisterConfigEntry {
  readonly id: string;
  readonly environment: EetEnvironment;
  readonly endpoint: string;
  readonly certificates: readonly CertificateConfig[];
  readonly defaults: RegisterDefaults;
  readonly timeoutMs?: number | undefined;
  readonly timeZone: string;
  readonly fieldMap?: FieldMap | undefined;
  readonly debug: boolean;
}

export interface ServerConfig {
  readonly server: { readonly host: string; readonly port: number };
  readonly apiKeys: readonly string[];
  /** Absolute path of the SQLite queue database. */
  readonly database: string;
  readonly timeZone: string;
  readonly queue: z.infer<typeof FileSchema>["queue"];
  readonly registers: readonly RegisterConfigEntry[];
  /** Started with `--dev`: API keys optional, production registers refused. */
  readonly dev: boolean;
}

export interface ParseConfigOptions {
  /** Process environment; only `EET_*` variables are read. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Relative paths in the configuration are relative to this directory (the file's). */
  readonly baseDir: string;
  readonly dev?: boolean | undefined;
  /** `false` for command-line use: API keys and `--dev` rules do not apply. Default `true`. */
  readonly server?: boolean | undefined;
}

/** `EET_REGISTER_<ID>_…`: the register id upper-cased, anything but A–Z and 0–9 as `_`. */
export function registerEnvId(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Parsed YAML (any value) + environment → checked configuration, or `ConfigError`. */
export function parseConfig(raw: unknown, options: ParseConfigOptions): ServerConfig {
  const env = options.env ?? {};
  const issues: ConfigIssue[] = [];
  const input = withEnv(structuredClone(raw ?? {}), env, issues);
  rejectInlinePasswords(input, issues);
  const parsed = FileSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      issues.push({ path: issue.path.join(".") || "(soubor)", message: issue.message });
  }
  if (!parsed.success || issues.length > 0) throw new ConfigError(issues);

  const file = parsed.data;
  const path = (p: string) => (isAbsolute(p) ? p : resolve(options.baseDir, p));
  const forServer = options.server !== false;
  const dev = forServer && options.dev === true;
  checkTimeZone(file.timeZone, "timeZone", issues);
  if (forServer && !dev && file.apiKeys.length === 0)
    issues.push({
      path: "apiKeys",
      message: "bez API klíčů služba nenaběhne (apiKeys nebo EET_API_KEYS); výjimkou je --dev",
    });

  const envIds = new Map<string, string>();
  const registers: RegisterConfigEntry[] = [];
  for (const [id, register] of Object.entries(file.registers)) {
    const at = `registers.${id}`;
    const envId = registerEnvId(id);
    const clash = envIds.get(envId);
    if (clash !== undefined)
      issues.push({ path: at, message: `koliduje s "${clash}" v EET_REGISTER_${envId}_*` });
    envIds.set(envId, id);

    if (dev && register.environment === "production")
      issues.push({ path: at, message: "--dev nesmí obsluhovat produkční pokladnu" });
    let endpoint = register.endpoint;
    if (endpoint === undefined && register.environment === "production") {
      endpoint = file.productionEndpoint;
      if (endpoint === undefined)
        issues.push({
          path: `${at}.endpoint`,
          message: "produkční endpoint chybí (productionEndpoint nebo EET_ENDPOINT_PRODUCTION)",
        });
    }
    if (register.certificates === undefined)
      issues.push({
        path: `${at}.certificates`,
        message: `chybí (nebo EET_REGISTER_${envId}_P12_PATH)`,
      });
    const timeZone = register.timeZone ?? file.timeZone;
    checkTimeZone(timeZone, `${at}.timeZone`, issues);
    for (const [key, field] of Object.entries(register.fieldMap ?? {})) {
      if (!CANONICAL_FIELDS.has(field))
        issues.push({ path: `${at}.fieldMap.${key}`, message: `"${field}" není pole EET` });
    }
    registers.push({
      id,
      environment: register.environment,
      endpoint: endpoint ?? EET_PLAYGROUND_ENDPOINT,
      certificates: (register.certificates ?? []).map((c) => ({
        p12: path(c.p12),
        passwordFile: c.passwordFile === undefined ? undefined : path(c.passwordFile),
        passwordEnv: `EET_REGISTER_${envId}_P12_PASSWORD`,
      })),
      defaults: register.defaults ?? {},
      timeoutMs: register.timeoutMs,
      timeZone,
      fieldMap: register.fieldMap as FieldMap | undefined,
      debug: register.debug,
    });
  }
  if (issues.length > 0) throw new ConfigError(issues);

  return {
    server: file.server,
    apiKeys: file.apiKeys,
    database: path(file.database),
    timeZone: file.timeZone,
    queue: file.queue,
    registers,
    dev,
  };
}

/** Applies `EET_*` overrides to the raw configuration before it is checked. */
function withEnv(raw: unknown, env: ParseConfigOptions["env"] & object, issues: ConfigIssue[]) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const config = raw as Record<string, unknown>;
  const set = (key: string, value: string | undefined, map: (v: string) => unknown = (v) => v) => {
    if (value !== undefined && value !== "") config[key] = map(value);
  };
  set("apiKeys", env["EET_API_KEYS"], (v) =>
    v
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k !== ""),
  );
  set("database", env["EET_DB_PATH"]);
  set("timeZone", env["EET_DEFAULT_TZ"]);
  set("productionEndpoint", env["EET_ENDPOINT_PRODUCTION"]);
  if (env["EET_HOST"] || env["EET_PORT"]) {
    const server = { ...(config["server"] as Record<string, unknown> | undefined) };
    if (env["EET_HOST"]) server["host"] = env["EET_HOST"];
    if (env["EET_PORT"]) server["port"] = env["EET_PORT"];
    config["server"] = server;
  }

  const registers = config["registers"];
  if (typeof registers !== "object" || registers === null) return config;
  const byEnvId = new Map(Object.keys(registers).map((id) => [registerEnvId(id), id]));
  for (const [name, value] of Object.entries(env)) {
    const match = /^EET_REGISTER_(.+)_P12_PATH$/.exec(name);
    if (match === null || value === undefined || value === "") continue;
    const id = byEnvId.get(match[1] as string);
    if (id === undefined) {
      issues.push({ path: name, message: "pokladna s tímto id v konfiguraci není" });
      continue;
    }
    const register = (registers as Record<string, Record<string, unknown>>)[id] ?? {};
    const certificates = register["certificates"];
    if (Array.isArray(certificates) && certificates.length > 1) {
      issues.push({ path: name, message: "pokladna má víc certifikátů; cesty uveď v konfiguraci" });
      continue;
    }
    const first = Array.isArray(certificates) ? (certificates[0] as object | undefined) : undefined;
    register["certificates"] = [{ ...first, p12: value }];
  }
  return config;
}

/** A password inside the file would end up in backups and repositories: refuse it. */
function rejectInlinePasswords(raw: unknown, issues: ConfigIssue[]) {
  const registers = (raw as { registers?: unknown } | null)?.registers;
  if (typeof registers !== "object" || registers === null) return;
  for (const [id, register] of Object.entries(registers)) {
    const certificates = (register as { certificates?: unknown } | null)?.certificates;
    if (!Array.isArray(certificates)) continue;
    certificates.forEach((certificate, index) => {
      if (typeof certificate === "object" && certificate !== null && "password" in certificate) {
        issues.push({
          path: `registers.${id}.certificates.${index}.password`,
          message: `heslo do konfiguračního souboru nepatří; použij passwordFile nebo EET_REGISTER_${registerEnvId(id)}_P12_PASSWORD`,
        });
        delete (certificate as { password?: unknown }).password;
      }
    });
  }
}

function checkTimeZone(timeZone: string, path: string, issues: ConfigIssue[]) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    issues.push({ path, message: `neznámá časová zóna "${timeZone}"` });
  }
}
