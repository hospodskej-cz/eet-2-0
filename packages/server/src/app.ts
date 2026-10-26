/**
 * HTTP API v1 as a Hono app. Runtime-neutral: give it a queue and register status and serve
 * `app.fetch` from Bun, Node or Deno (the Bun service: serve.ts). Contract: docs/SERVER.md and
 * the OpenAPI document (openapi.ts).
 */
import { checkEndpoint as defaultCheckEndpoint, type EndpointCheck } from "@eet-gateway/core";
import { type BatchFormat, formatFromContentType, readSales } from "@eet-gateway/ingest";
import {
  type EetQueue,
  invalidResult,
  QueueError,
  SALE_STATUSES,
  type SaleResult,
  type SaleStatus,
} from "@eet-gateway/queue";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DOCS_PAGE } from "./docs-page.ts";
import {
  apiKeyChecker,
  type ErrorCode,
  errorBody,
  isReplay,
  mediaType,
  parseFlag,
  saleStatusCode,
} from "./http.ts";
import { VERSION } from "./index.ts";
import { buildOpenApi } from "./openapi.ts";
import type { RegisterStatus } from "./registers.ts";
import type { AttemptSchema } from "./schemas.ts";

export interface RequestLog {
  readonly method: string;
  /** Route pattern, e.g. `/v1/sales/:id` — never the query or the body. */
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
}

export interface AppOptions {
  readonly queue: EetQueue;
  /** Bearer tokens accepted on /v1; empty only with `dev`. */
  readonly apiKeys: readonly string[];
  /** Without API keys, /v1 is open (development only). */
  readonly dev?: boolean | undefined;
  /** Current registers and certificate validity, for GET /v1/registers. */
  readonly registers: () => RegisterStatus[];
  /** EET endpoints in use, for GET /health?eet=true. */
  readonly endpoints?: readonly string[] | undefined;
  readonly checkEndpoint?: ((endpoint: string) => Promise<EndpointCheck>) | undefined;
  /** Throws when the queue database is not usable. */
  readonly ping?: (() => Promise<void>) | undefined;
  /** Default: this package's version. */
  readonly version?: string | undefined;
  readonly now?: (() => number) | undefined;
  readonly onRequest?: ((entry: RequestLog) => void) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  /** Body limits in bytes. */
  readonly limits?: { readonly sale?: number; readonly batch?: number } | undefined;
}

const SALE_LIMIT = 64 * 1024;
const BATCH_LIMIT = 10 * 1024 * 1024;
const EET_CHECK_TTL_MS = 60_000;
const KEY = /^[\x21-\x7e]{1,255}$/;

type Attempt = Awaited<ReturnType<EetQueue["attempts"]>>[number];
type AttemptBody = ReturnType<(typeof AttemptSchema)["parse"]>;

export function createApp(options: AppOptions): Hono {
  const { queue } = options;
  const now = options.now ?? Date.now;
  const version = options.version ?? VERSION;
  const check = options.checkEndpoint ?? ((endpoint: string) => defaultCheckEndpoint(endpoint));
  const authorized = apiKeyChecker(options.apiKeys);
  const open = options.dev === true && options.apiKeys.length === 0;
  const openapi = buildOpenApi(version);
  let eetChecks: { at: number; results: Promise<unknown[]> } | undefined;

  const app = new Hono();
  const fail = (
    c: Context,
    status: 400 | 401 | 404 | 409 | 413 | 415 | 422,
    code: ErrorCode,
    message: string,
  ) => c.json(errorBody(code, message), status);
  const limit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) => fail(c, 413, "payload_too_large", `Tělo je větší než ${maxSize} B.`),
    });

  app.use(async (c, next) => {
    const started = now();
    await next();
    options.onRequest?.({
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      durationMs: now() - started,
    });
  });
  app.onError((error, c) => {
    options.onError?.(error);
    return c.json(errorBody("internal", "Interní chyba serveru."), 500);
  });
  app.notFound((c) => fail(c, 404, "not_found", "Neznámá cesta."));

  app.use("/v1/*", async (c, next) => {
    if (open) return next();
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (token === undefined || !(await authorized(token))) {
      c.header("WWW-Authenticate", 'Bearer realm="eet-gateway"');
      return fail(c, 401, "unauthorized", "Chybí nebo nesedí API klíč (Authorization: Bearer …).");
    }
    return next();
  });

  /** Common query and header options of submit endpoints; a string is an error message. */
  function submitOptions(c: Context, fallbackMode: "sync" | "async") {
    const mode = c.req.query("mode") ?? fallbackMode;
    if (mode !== "sync" && mode !== "async") return "mode: sync nebo async";
    const verifyText = c.req.query("verify");
    const verify = verifyText === undefined ? false : parseFlag(verifyText);
    if (verify === undefined) return "verify: true nebo false";
    const idempotencyKey = c.req.header("idempotency-key");
    if (idempotencyKey !== undefined && !KEY.test(idempotencyKey))
      return "Idempotency-Key: 1–255 tisknutelných znaků ASCII";
    const register = c.req.query("register");
    return {
      mode,
      verify,
      ...(register ? { register } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    } as const;
  }

  function sale(c: Context, result: SaleResult) {
    if (result.id !== undefined) c.header("Location", `/v1/sales/${result.id}`);
    if (isReplay(result)) c.header("Idempotent-Replayed", "true");
    return c.json(result, saleStatusCode(result));
  }

  /** Raw body for batch formats; CSV stays bytes so Windows-1250 can be detected. */
  async function batchBody(
    c: Context,
  ): Promise<{ format: BatchFormat; source: Uint8Array } | undefined> {
    const format = formatFromContentType(c.req.header("content-type") ?? "");
    if (format === undefined) return undefined;
    return { format, source: new Uint8Array(await c.req.arrayBuffer()) };
  }

  app.post("/v1/sales", limit(options.limits?.sale ?? SALE_LIMIT), async (c) => {
    const opts = submitOptions(c, "sync");
    if (typeof opts === "string") return fail(c, 400, "bad_request", opts);
    const type = mediaType(c.req.header("content-type"));
    let input: unknown;
    let readWarnings: SaleResult["warnings"] = [];
    if (type === "application/x-www-form-urlencoded" || type === "multipart/form-data") {
      const fields = await c.req.parseBody();
      if (Object.values(fields).some((v) => typeof v !== "string"))
        return fail(c, 415, "unsupported_media_type", "Formulář nesmí obsahovat soubory.");
      input = fields;
    } else {
      const format = formatFromContentType(type);
      if (format !== "json" && format !== "xml")
        return fail(
          c,
          415,
          "unsupported_media_type",
          "Content-Type: application/json, application/xml nebo formulář; dávky na /v1/sales/batch.",
        );
      const read = readSales(new Uint8Array(await c.req.arrayBuffer()), format);
      if (read.issues.length > 0) return sale(c, invalidResult(read.issues, read.warnings));
      if (read.rows.length !== 1 || (format === "json" && Array.isArray(read.rows[0]?.input)))
        return fail(
          c,
          422,
          "single_sale_expected",
          "Čekám právě jednu tržbu; dávky patří na /v1/sales/batch.",
        );
      const [row] = read.rows;
      if (row === undefined || row.issues.length > 0)
        return sale(c, invalidResult(row?.issues ?? [], row?.warnings ?? []));
      input = row.input;
      readWarnings = [...read.warnings, ...row.warnings];
    }
    const result = await queue.submit(input, opts);
    return sale(c, { ...result, warnings: [...readWarnings, ...result.warnings] });
  });

  app.post("/v1/sales/batch", limit(options.limits?.batch ?? BATCH_LIMIT), async (c) => {
    const opts = submitOptions(c, "async");
    if (typeof opts === "string") return fail(c, 400, "bad_request", opts);
    const body = await batchBody(c);
    if (body === undefined)
      return fail(
        c,
        415,
        "unsupported_media_type",
        "Content-Type: application/json, application/x-ndjson, text/csv nebo application/xml.",
      );
    const result = await queue.submitBatch(body.source, body.format, opts);
    return c.json(result, result.issues.length > 0 ? 422 : 200);
  });

  app.get("/v1/sales/:id", async (c) => {
    const result = await queue.get(c.req.param("id"));
    if (result === undefined) return fail(c, 404, "not_found", "Záznam neexistuje.");
    return c.json(result, 200);
  });

  app.get("/v1/sales/:id/attempts", async (c) => {
    const id = c.req.param("id");
    if ((await queue.get(id)) === undefined) return fail(c, 404, "not_found", "Záznam neexistuje.");
    return c.json({ items: (await queue.attempts(id)).map(attemptBody) }, 200);
  });

  app.post("/v1/sales/:id/retry", async (c) => {
    try {
      return sale(c, await queue.retry(c.req.param("id")));
    } catch (error) {
      if (!(error instanceof QueueError)) throw error;
      return error.code === "not_found"
        ? fail(c, 404, "not_found", error.message)
        : fail(c, 409, error.code, error.message);
    }
  });

  app.get("/v1/queue", async (c) => {
    const statusText = c.req.query("status");
    const status = statusText
      ?.split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const unknown = status?.find((s) => !(SALE_STATUSES as readonly string[]).includes(s));
    if (unknown !== undefined)
      return fail(c, 400, "bad_request", `status: neznámý stav "${unknown}"`);
    const overdueText = c.req.query("overdue");
    const overdue = overdueText === undefined ? undefined : parseFlag(overdueText);
    if (overdueText !== undefined && overdue === undefined)
      return fail(c, 400, "bad_request", "overdue: true nebo false");
    const limitText = c.req.query("limit");
    const pageSize = limitText === undefined ? undefined : Number(limitText);
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500))
      return fail(c, 400, "bad_request", "limit: celé číslo 1–500");
    try {
      const page = await queue.list({
        status: status as SaleStatus[] | undefined,
        register: c.req.query("register"),
        from: c.req.query("from"),
        to: c.req.query("to"),
        overdue,
        limit: pageSize,
        cursor: c.req.query("cursor"),
      });
      return c.json(page, 200);
    } catch (error) {
      if (error instanceof RangeError) return fail(c, 400, "bad_request", error.message);
      throw error;
    }
  });

  app.get("/v1/registers", (c) => c.json({ items: options.registers() }, 200));

  app.post("/v1/validate", limit(options.limits?.batch ?? BATCH_LIMIT), async (c) => {
    const verifyText = c.req.query("verify");
    const verify = verifyText === undefined ? false : parseFlag(verifyText);
    if (verify === undefined) return fail(c, 400, "bad_request", "verify: true nebo false");
    const body = await batchBody(c);
    if (body === undefined)
      return fail(
        c,
        415,
        "unsupported_media_type",
        "Content-Type: application/json, application/x-ndjson, text/csv nebo application/xml.",
      );
    const register = c.req.query("register");
    const result = queue.validateBatch(body.source, body.format, {
      verify,
      ...(register ? { register } : {}),
    });
    return c.json(result, result.issues.length > 0 ? 422 : 200);
  });

  app.get("/health", async (c) => {
    let database: "ok" | "error" = "ok";
    try {
      await options.ping?.();
    } catch (error) {
      options.onError?.(error);
      database = "error";
    }
    let eet: Record<string, unknown>[] | undefined;
    if (parseFlag(c.req.query("eet")) === true) {
      if (eetChecks === undefined || now() - eetChecks.at > EET_CHECK_TTL_MS) {
        const at = now();
        eetChecks = {
          at,
          results: Promise.all(
            [...new Set(options.endpoints ?? [])].map(async (endpoint) => ({
              endpoint,
              ...(await check(endpoint)),
              checkedAt: new Date(at).toISOString(),
            })),
          ),
        };
      }
      eet = (await eetChecks.results) as Record<string, unknown>[];
    }
    const healthy = database === "ok" && (eet ?? []).every((e) => e["reachable"] === true);
    return c.json(
      { status: healthy ? "ok" : "degraded", version, database, ...(eet ? { eet } : {}) },
      healthy ? 200 : 503,
    );
  });

  app.get("/openapi.json", (c) => c.json(openapi, 200));
  app.get("/docs", (c) => c.html(DOCS_PAGE));

  return app;
}

function attemptBody(attempt: Attempt): AttemptBody {
  const iso = (ms: number | undefined) =>
    ms === undefined ? undefined : new Date(ms).toISOString();
  const body = {
    n: attempt.n,
    uuid_zpravy: attempt.uuid_zpravy,
    dat_odesl: attempt.dat_odesl,
    prvni_zaslani: attempt.prvni_zaslani,
    overeni: attempt.overeni,
    environment: attempt.environment,
    endpoint: attempt.endpoint,
    startedAt: iso(attempt.startedAt) as string,
    finishedAt: iso(attempt.finishedAt),
    outcome: attempt.outcome,
    reason: attempt.reason,
    code: attempt.code,
    message: attempt.message,
    pok: attempt.pok,
    httpStatus: attempt.httpStatus,
    globalTransactionId: attempt.globalTransactionId,
    durationMs: attempt.durationMs,
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as AttemptBody;
}
