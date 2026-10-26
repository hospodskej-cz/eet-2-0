/**
 * @eet-gateway/queue — persistent outbound queue: every sale is stored before it is sent and
 * resent safely after failures (new `uuid_zpravy`, `prvni_zaslani=false`, identical `<Data>`).
 * Runs on Bun, Node 22.18+ and Deno 2; storage is pluggable. Contract: docs/QUEUE.md, policy:
 * docs/ADR-003-queue-retry-policy.md.
 */

export { QueueError, type QueueErrorCode, type QueueIssueCode, QueueWarningCode } from "./codes.ts";
export { createMemoryStore } from "./memory-store.ts";
export {
  backoffDelay,
  DEFAULT_RETRY_POLICY,
  type Decision,
  type DecisionContext,
  decide,
  type OutcomeSummary,
  type RetryPolicy,
} from "./policy.ts";
export {
  type BatchSubmitResult,
  type BatchValidationResult,
  createEetQueue,
  type EetQueue,
  type EetQueueOptions,
  type ListOptions,
  type QueueEvent,
  type RegisterConfig,
  type SubmitOptions,
} from "./queue.ts";
export {
  invalidResult,
  isOverdue,
  SALE_STATUSES,
  type SaleIssue,
  SaleIssueSchema,
  type SaleResult,
  SaleResultSchema,
  type SaleStatus,
  type SaleWarning,
  SaleWarningSchema,
  type ValidationResult,
  ValidationResultSchema,
} from "./result.ts";
export {
  createSqliteStore,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from "./sqlite-store.ts";
export type {
  AttemptEnd,
  AttemptOutcome,
  AttemptRecord,
  AttemptStart,
  ClaimFilter,
  InsertResult,
  ListFilter,
  ListPage,
  QueueStore,
  SaleRecord,
  SaleState,
} from "./store.ts";

export const VERSION = "0.1.0"; // x-release-please-version
