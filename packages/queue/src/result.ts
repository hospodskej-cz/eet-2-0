/**
 * `SaleResult` — the one result shape shared by the library, the HTTP API and the CLI. The zod
 * schema is the source of truth so the API (phase 5) can publish it in OpenAPI unchanged.
 */
import { z } from "zod";
import type { SaleRecord } from "./store.ts";

export const SALE_STATUSES = [
  "accepted",
  "verification_ok",
  "rejected",
  "queued",
  "uncertain",
  "invalid",
] as const;

/**
 * - `queued`: not registered yet; will be sent (again)
 * - `uncertain`: an attempt may have reached EET but no answer came back; see `nextAttemptAt`
 * - `accepted`, `verification_ok`: final, EET answered
 * - `rejected`: final until retried by hand; EET refused the message
 * - `invalid`: final; failed local validation, nothing was sent
 */
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SaleWarningSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  source: z.enum(["eet", "ingest", "queue"]),
  field: z.string().optional(),
});

export const SaleIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
});

export const SaleResultSchema = z.object({
  id: z.string().optional().describe("Record id in the queue; absent when nothing was stored."),
  status: z.enum(SALE_STATUSES),
  register: z.string().optional(),
  pok: z.string().optional().describe("Fiscal identification code from EET (accepted only)."),
  uuid: z.string().optional().describe("`uuid_zpravy` of the last attempt."),
  test: z.boolean().optional().describe("EET answered from the playground."),
  code: z.number().int().optional().describe("EET error code of the last answer (`kod`)."),
  message: z.string().optional(),
  reason: z
    .string()
    .optional()
    .describe("Why the last attempt has no EET answer: timeout, network, interrupted, …"),
  warnings: z.array(SaleWarningSchema),
  issues: z.array(SaleIssueSchema).optional().describe("Why the sale is invalid."),
  attempts: z.number().int(),
  nextAttemptAt: z.string().optional().describe("Next automatic attempt (ISO 8601 UTC)."),
  overdue: z
    .boolean()
    .optional()
    .describe("No POK 48 hours after the sale (ZoET §20); absent in verification mode."),
  createdAt: z.string().optional(),
  deadlineAt: z.string().optional(),
  httpStatus: z.number().int().optional(),
  globalTransactionId: z.string().optional(),
  rawRequest: z.string().optional().describe("Debug only; never stored, signatures redacted."),
  rawResponse: z.string().optional().describe("Debug only; never stored."),
});

export type SaleResult = z.infer<typeof SaleResultSchema>;
export type SaleWarning = z.infer<typeof SaleWarningSchema>;
export type SaleIssue = z.infer<typeof SaleIssueSchema>;

/** The sale lacks a POK 48 hours after it happened (ZoET §20); never in verification mode. */
export function isOverdue(record: SaleRecord, now: number): boolean {
  return (
    record.deadlineAt !== undefined &&
    now > record.deadlineAt &&
    record.status !== "accepted" &&
    record.status !== "verification_ok"
  );
}

const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

/** Drops `undefined` values so results serialize and compare cleanly. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function recordResult(record: SaleRecord, now: number): SaleResult {
  return compact({
    id: record.id,
    status: record.status,
    register: record.register,
    pok: record.pok,
    uuid: record.uuid,
    test: record.test,
    code: record.code,
    message: record.message,
    reason: record.reason,
    warnings: [
      ...record.ingestWarnings,
      ...record.eetWarnings.map((w) => ({
        code: w.code,
        message: w.message,
        source: "eet" as const,
      })),
    ],
    attempts: record.attempts,
    nextAttemptAt: iso(record.nextAttemptAt),
    overdue: record.deadlineAt === undefined ? undefined : isOverdue(record, now),
    createdAt: iso(record.createdAt),
    deadlineAt: iso(record.deadlineAt),
    httpStatus: record.httpStatus,
    globalTransactionId: record.globalTransactionId,
  });
}

export function invalidResult(
  issues: readonly SaleIssue[],
  warnings: readonly SaleWarning[] = [],
): SaleResult {
  return { status: "invalid", warnings: [...warnings], issues: [...issues], attempts: 0 };
}
