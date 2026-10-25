/**
 * The OpenAPI 3.1 document of API v1, generated from the zod schemas (zod's own JSON Schema
 * output, draft 2020-12, which OpenAPI 3.1 uses as is). `ROUTES` is the table of operations; a
 * test keeps it in sync with the Hono routes, and docs/openapi.json with this generator.
 */
import { z } from "zod";
import {
  AttemptListSchema,
  BatchResultSchema,
  ErrorSchema,
  HealthSchema,
  QueuePageSchema,
  RegisterListSchema,
  SALE_STATUSES,
  SaleInputSchema,
  SaleResultSchema,
  ValidationBatchSchema,
} from "./schemas.ts";

const COMPONENTS = {
  SaleInput: { schema: SaleInputSchema, io: "input" },
  SaleResult: { schema: SaleResultSchema, io: "output" },
  BatchResult: { schema: BatchResultSchema, io: "output" },
  ValidationBatch: { schema: ValidationBatchSchema, io: "output" },
  AttemptList: { schema: AttemptListSchema, io: "output" },
  QueuePage: { schema: QueuePageSchema, io: "output" },
  RegisterList: { schema: RegisterListSchema, io: "output" },
  Health: { schema: HealthSchema, io: "output" },
  Error: { schema: ErrorSchema, io: "output" },
} as const;

export type ComponentName = keyof typeof COMPONENTS;

type JsonSchema = Record<string, unknown>;
const ref = (name: ComponentName): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const text: JsonSchema = { type: "string" };

interface Parameter {
  readonly name: string;
  readonly in: "query" | "path" | "header";
  readonly description: string;
  readonly required?: boolean;
  readonly schema: JsonSchema;
}

interface Response {
  readonly description: string;
  readonly schema?: ComponentName;
  readonly headers?: Record<string, { description: string; schema: JsonSchema }>;
}

export interface RouteDoc {
  readonly method: "get" | "post";
  /** OpenAPI path, e.g. `/v1/sales/{id}`. */
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tag: "Sales" | "Queue" | "Registers" | "System";
  /** Requires `Authorization: Bearer <API key>`. */
  readonly auth: boolean;
  readonly parameters?: readonly Parameter[];
  readonly requestBody?: { description: string; content: Record<string, JsonSchema> };
  readonly responses: Record<string, Response>;
}

const id: Parameter = {
  name: "id",
  in: "path",
  required: true,
  description: "Record id from SaleResult.id.",
  schema: text,
};
const register: Parameter = {
  name: "register",
  in: "query",
  description: "Register id; may also come from the input field `register`.",
  schema: text,
};
const verify: Parameter = {
  name: "verify",
  in: "query",
  description: "Verification mode (`overeni`): EET checks the message and registers nothing.",
  schema: { type: "boolean", default: false },
};
const mode = (fallback: "sync" | "async"): Parameter => ({
  name: "mode",
  in: "query",
  description:
    "`sync` waits for the first attempt; `async` stores the sale, answers 202 and sends it in the background right away.",
  schema: { type: "string", enum: ["sync", "async"], default: fallback },
});
const idempotencyKey = (batch: boolean): Parameter => ({
  name: "Idempotency-Key",
  in: "header",
  description: batch
    ? "Repeating the request with the same key never registers a row twice; each row is keyed `<key>:<row>`."
    : "Repeating the request with the same key returns the stored result instead of sending again.",
  schema: { type: "string", minLength: 1, maxLength: 255 },
});

const replayed = {
  "Idempotent-Replayed": {
    description: "`true` when the sale was already queued and the stored result is returned.",
    schema: text,
  },
};
const location = { Location: { description: "URL of the queued record.", schema: text } };

const error = (description: string): Response => ({ description, schema: "Error" });
const unauthorized = error("Missing or wrong API key (`Authorization: Bearer …`).");
const saleResponses: Record<string, Response> = {
  "200": {
    description: "EET answered: `accepted`, `verification_ok` or `rejected` (see `status`).",
    schema: "SaleResult",
    headers: { ...replayed, ...location },
  },
  "202": {
    description: "Not settled yet: `queued` or `uncertain`; poll the Location.",
    schema: "SaleResult",
    headers: { ...replayed, ...location },
  },
  "401": unauthorized,
  "409": { description: "Idempotency key already used for another sale.", schema: "SaleResult" },
  "413": error("Body too large."),
  "422": { description: "`invalid`: see `issues`; nothing was sent.", schema: "SaleResult" },
};
const batchBody = (what: string) => ({
  description: `${what} The format follows Content-Type; CSV may be UTF-8 or Windows-1250.`,
  content: {
    "application/json": { oneOf: [ref("SaleInput"), { type: "array", items: ref("SaleInput") }] },
    "application/x-ndjson": text,
    "text/csv": text,
    "application/xml": text,
  },
});

export const ROUTES: readonly RouteDoc[] = [
  {
    method: "post",
    path: "/v1/sales",
    operationId: "submitSale",
    summary: "Submit one sale",
    description:
      "Validates the sale, stores it and sends it to EET. Accepts JSON, XML (`<Data>` or `<Trzba>`) and form fields; field names and formats: docs/INGEST.md.",
    tag: "Sales",
    auth: true,
    parameters: [mode("sync"), verify, register, idempotencyKey(false)],
    requestBody: {
      description: "One sale.",
      content: {
        "application/json": ref("SaleInput"),
        "application/xml": text,
        "application/x-www-form-urlencoded": ref("SaleInput"),
        "multipart/form-data": ref("SaleInput"),
      },
    },
    responses: {
      ...saleResponses,
      "400": error("Bad query or header."),
      "415": error("Unsupported Content-Type."),
    },
  },
  {
    method: "post",
    path: "/v1/sales/batch",
    operationId: "submitBatch",
    summary: "Submit a batch of sales",
    description:
      "Meant for resending after an outage and for migration; sales should be sent as they happen (metodika 1.2). Every row is stored and sent on its own.",
    tag: "Sales",
    auth: true,
    parameters: [mode("async"), verify, register, idempotencyKey(true)],
    requestBody: batchBody("Sales, one per row."),
    responses: {
      "200": { description: "One result per row.", schema: "BatchResult" },
      "400": error("Bad query or header."),
      "401": unauthorized,
      "413": error("Body too large."),
      "415": error("Unsupported Content-Type."),
      "422": { description: "The source could not be read at all.", schema: "BatchResult" },
    },
  },
  {
    method: "get",
    path: "/v1/sales/{id}",
    operationId: "getSale",
    summary: "Current state of a sale",
    tag: "Sales",
    auth: true,
    parameters: [id],
    responses: {
      "200": { description: "The record.", schema: "SaleResult" },
      "401": unauthorized,
      "404": error("No such record."),
    },
  },
  {
    method: "get",
    path: "/v1/sales/{id}/attempts",
    operationId: "getSaleAttempts",
    summary: "Attempts to send a sale",
    description: "Every message sent for the sale, with `uuid_zpravy` and `dat_odesl`.",
    tag: "Sales",
    auth: true,
    parameters: [id],
    responses: {
      "200": { description: "Attempts in order.", schema: "AttemptList" },
      "401": unauthorized,
      "404": error("No such record."),
    },
  },
  {
    method: "post",
    path: "/v1/sales/{id}/retry",
    operationId: "retrySale",
    summary: "Send a stored sale again now",
    description:
      "For `queued`, `uncertain` and `rejected` records (e.g. after fixing the certificate). Always `prvni_zaslani=false` after the first attempt.",
    tag: "Sales",
    auth: true,
    parameters: [id],
    responses: {
      "200": saleResponses["200"] as Response,
      "202": saleResponses["202"] as Response,
      "401": unauthorized,
      "404": error("No such record."),
      "409": error("Final record (`not_retryable`), being sent (`in_progress`) or register gone."),
    },
  },
  {
    method: "get",
    path: "/v1/queue",
    operationId: "listQueue",
    summary: "Queue overview",
    tag: "Queue",
    auth: true,
    parameters: [
      {
        name: "status",
        in: "query",
        description: `Comma-separated: ${SALE_STATUSES.join(", ")}.`,
        schema: text,
      },
      { name: "register", in: "query", description: "Register id.", schema: text },
      {
        name: "from",
        in: "query",
        description: "`dat_trzby` from (inclusive), ISO 8601.",
        schema: { type: "string", format: "date-time" },
      },
      {
        name: "to",
        in: "query",
        description: "`dat_trzby` to (exclusive), ISO 8601.",
        schema: { type: "string", format: "date-time" },
      },
      {
        name: "overdue",
        in: "query",
        description:
          "Only sales without POK 48 h after they happened (ZoET §20), or only the others.",
        schema: { type: "boolean" },
      },
      {
        name: "limit",
        in: "query",
        description: "Page size.",
        schema: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      {
        name: "cursor",
        in: "query",
        description: "`nextCursor` of the previous page.",
        schema: text,
      },
    ],
    responses: {
      "200": { description: "Newest first.", schema: "QueuePage" },
      "400": error("Bad filter."),
      "401": unauthorized,
    },
  },
  {
    method: "get",
    path: "/v1/registers",
    operationId: "listRegisters",
    summary: "Registers and their certificates",
    description: "Certificate validity, including a warning 21 days before expiry.",
    tag: "Registers",
    auth: true,
    responses: {
      "200": { description: "Configured registers.", schema: "RegisterList" },
      "401": unauthorized,
    },
  },
  {
    method: "post",
    path: "/v1/validate",
    operationId: "validateSales",
    summary: "Validate sales without sending",
    description:
      "Runs the same ingest and register defaults as submitting; nothing is stored or sent.",
    tag: "Sales",
    auth: true,
    parameters: [verify, register],
    requestBody: batchBody("One sale or a batch."),
    responses: {
      "200": { description: "One result per row.", schema: "ValidationBatch" },
      "401": unauthorized,
      "413": error("Body too large."),
      "415": error("Unsupported Content-Type."),
      "422": { description: "The source could not be read at all.", schema: "ValidationBatch" },
    },
  },
  {
    method: "get",
    path: "/health",
    operationId: "health",
    summary: "Liveness and readiness",
    tag: "System",
    auth: false,
    parameters: [
      {
        name: "eet",
        in: "query",
        description: "Also check that every EET endpoint is reachable (OPTIONS preflight only).",
        schema: { type: "boolean", default: false },
      },
    ],
    responses: {
      "200": { description: "Healthy.", schema: "Health" },
      "503": { description: "Database or (with ?eet=true) EET unreachable.", schema: "Health" },
    },
  },
  {
    method: "get",
    path: "/openapi.json",
    operationId: "openapi",
    summary: "This OpenAPI document",
    tag: "System",
    auth: false,
    responses: { "200": { description: "OpenAPI 3.1." } },
  },
  {
    method: "get",
    path: "/docs",
    operationId: "docs",
    summary: "API reference (HTML)",
    tag: "System",
    auth: false,
    responses: { "200": { description: "Interactive documentation." } },
  },
];

/** JSON Schema of a component, without the `$schema` keyword. */
export function componentSchema(name: ComponentName): JsonSchema {
  const { schema, io } = COMPONENTS[name];
  const { $schema: _, ...json } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  }) as JsonSchema;
  return json;
}

export function buildOpenApi(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    paths[route.path] ??= {};
    (paths[route.path] as Record<string, unknown>)[route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      ...(route.description !== undefined ? { description: route.description } : {}),
      tags: [route.tag],
      ...(route.auth ? { security: [{ apiKey: [] }] } : {}),
      ...(route.parameters !== undefined ? { parameters: route.parameters } : {}),
      ...(route.requestBody !== undefined
        ? {
            requestBody: {
              required: true,
              description: route.requestBody.description,
              content: Object.fromEntries(
                Object.entries(route.requestBody.content).map(([type, schema]) => [
                  type,
                  { schema },
                ]),
              ),
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(route.responses).map(([status, response]) => [
          status,
          {
            description: response.description,
            ...(response.headers !== undefined ? { headers: response.headers } : {}),
            ...(response.schema !== undefined
              ? { content: { "application/json": { schema: ref(response.schema) } } }
              : {}),
          },
        ]),
      ),
    };
  }
  return {
    openapi: "3.1.1",
    info: {
      title: "EET Gateway API",
      version,
      summary: "Sends sales to the Czech EET 2.0 (Finanční správa ČR) with a persistent queue.",
      license: { name: "MIT", identifier: "MIT" },
    },
    tags: [
      { name: "Sales", description: "Submitting, validating and resending sales." },
      { name: "Queue", description: "What is waiting, uncertain or overdue." },
      { name: "Registers", description: "Configured registers and certificates." },
      { name: "System", description: "Health and documentation." },
    ],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "An API key from the server configuration (apiKeys, EET_API_KEYS).",
        },
      },
      schemas: Object.fromEntries(
        (Object.keys(COMPONENTS) as ComponentName[]).map((name) => [name, componentSchema(name)]),
      ),
    },
  };
}
