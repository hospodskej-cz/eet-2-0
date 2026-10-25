/**
 * Response shapes of HTTP API v1. Together with `SaleResultSchema` (queue) and `SaleInputSchema`
 * (ingest) they are the single source of the OpenAPI document (openapi.ts).
 */
import { SaleInputSchema } from "@eet-gateway/ingest";
import {
  SALE_STATUSES,
  SaleIssueSchema,
  SaleResultSchema,
  SaleWarningSchema,
  ValidationResultSchema,
} from "@eet-gateway/queue";
import { z } from "zod";
import { RegisterStatusSchema } from "./registers.ts";

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string().describe("Stable machine-readable code, e.g. unauthorized, not_found."),
    message: z.string(),
  }),
});

const row = z.int().describe("JSON array: position from 1; NDJSON, CSV, XML: line number.");

export const BatchResultSchema = z.object({
  rows: z.array(z.object({ row, result: SaleResultSchema })),
  warnings: z.array(SaleWarningSchema).describe("About the whole source, e.g. CP1250 decoding."),
  issues: z.array(SaleIssueSchema).describe("Non-empty when the source could not be read."),
});

export const ValidationBatchSchema = z.object({
  rows: z.array(z.object({ row, result: ValidationResultSchema })),
  warnings: z.array(SaleWarningSchema),
  issues: z.array(SaleIssueSchema),
});

export const AttemptSchema = z.object({
  n: z.int(),
  uuid_zpravy: z.string(),
  dat_odesl: z.string(),
  prvni_zaslani: z.boolean(),
  overeni: z.boolean(),
  environment: z.enum(["playground", "production"]),
  endpoint: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional().describe("Absent while the attempt is running."),
  outcome: z
    .enum(["accepted", "verification_ok", "rejected", "not_sent", "uncertain", "interrupted"])
    .optional(),
  reason: z.string().optional(),
  code: z.int().optional(),
  message: z.string().optional(),
  pok: z.string().optional(),
  httpStatus: z.int().optional(),
  globalTransactionId: z.string().optional(),
  durationMs: z.int().optional(),
});

export const AttemptListSchema = z.object({ items: z.array(AttemptSchema) });

export const QueuePageSchema = z.object({
  items: z.array(SaleResultSchema),
  nextCursor: z.string().optional().describe("Pass as `cursor` for the next page."),
});

export const RegisterListSchema = z.object({ items: z.array(RegisterStatusSchema) });

export const HealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  database: z.enum(["ok", "error"]),
  eet: z
    .array(
      z.object({
        endpoint: z.string(),
        reachable: z.boolean(),
        httpStatus: z.int().optional(),
        durationMs: z.number(),
        error: z.string().optional(),
        checkedAt: z.string(),
      }),
    )
    .optional()
    .describe("Only with ?eet=true: a CORS preflight to each EET endpoint, cached for 60 s."),
});

export {
  RegisterStatusSchema,
  SALE_STATUSES,
  SaleInputSchema,
  SaleResultSchema,
  ValidationResultSchema,
};
