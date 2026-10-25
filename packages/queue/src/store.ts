/**
 * `QueueStore` — persistence behind the queue. The queue owns every decision (docs/ADR-003);
 * a store only keeps records and makes the few operations that race atomic. Implementations:
 * `createSqliteStore` (bun:sqlite, node:sqlite) and `createMemoryStore` (tests only). A Postgres
 * store implements the same interface and must pass the same contract tests.
 *
 * Times are epoch milliseconds. Records returned by a store are copies, never live objects.
 */
import type { EetEnvironment, EetReceiptData, EetWarning } from "@eet-gateway/core";
import type { IngestWarning } from "@eet-gateway/ingest";
import type { SaleStatus } from "./result.ts";

/** How an attempt ended: a transport outcome, or `interrupted` when the process died mid-way. */
export type AttemptOutcome =
  | "accepted"
  | "verification_ok"
  | "rejected"
  | "not_sent"
  | "uncertain"
  | "interrupted";

/** The changing part of a record: the last known result and the schedule. */
export interface SaleState {
  readonly status: SaleStatus;
  /** Attempts started so far, including any that never finished. */
  readonly attempts: number;
  /** Earliest time of the next automatic attempt; undefined means none is planned. */
  readonly nextAttemptAt?: number | undefined;
  /** Set while a worker holds the record (ADR-003, write-ahead and lease). */
  readonly leaseUntil?: number | undefined;
  readonly updatedAt: number;
  /** `uuid_zpravy` of the last attempt. */
  readonly uuid?: string | undefined;
  readonly pok?: string | undefined;
  readonly test?: boolean | undefined;
  readonly code?: number | undefined;
  readonly message?: string | undefined;
  readonly reason?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly globalTransactionId?: string | undefined;
  readonly eetWarnings: readonly EetWarning[];
}

export interface SaleRecord extends SaleState {
  readonly id: string;
  readonly register: string;
  readonly idempotencyKey?: string | undefined;
  /** Uniqueness key (rozhraní §4); unique among records outside verification mode. */
  readonly saleKey: string;
  /** `overeni`: verification mode, nothing is registered. */
  readonly verification: boolean;
  /** `false` when the caller had already tried to send this sale before it was queued. */
  readonly firstSubmission: boolean;
  /** Final EET values; every attempt sends exactly these. */
  readonly data: EetReceiptData;
  readonly ingestWarnings: readonly IngestWarning[];
  /** `dat_trzby`. */
  readonly saleAt: number;
  /** `dat_trzby` + 48 h (ZoET §20); undefined in verification mode. */
  readonly deadlineAt?: number | undefined;
  readonly createdAt: number;
}

/** Written before anything goes over the network (write-ahead). */
export interface AttemptStart {
  readonly saleId: string;
  /** 1-based, consecutive per sale. */
  readonly n: number;
  readonly uuid_zpravy: string;
  readonly dat_odesl: string;
  readonly prvni_zaslani: boolean;
  readonly overeni: boolean;
  readonly environment: EetEnvironment;
  readonly endpoint: string;
  readonly startedAt: number;
}

export interface AttemptEnd {
  readonly finishedAt: number;
  readonly outcome: AttemptOutcome;
  readonly reason?: string | undefined;
  readonly code?: number | undefined;
  readonly message?: string | undefined;
  readonly pok?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly globalTransactionId?: string | undefined;
  readonly durationMs?: number | undefined;
}

/** An attempt; the `AttemptEnd` fields are absent while it is open. */
export type AttemptRecord = AttemptStart & { readonly [K in keyof AttemptEnd]?: AttemptEnd[K] };

export type InsertResult =
  | { readonly inserted: true }
  | {
      readonly inserted: false;
      readonly existing: SaleRecord;
      readonly conflict: "idempotency_key" | "sale_key";
    };

export interface ClaimFilter {
  /** Only records of these registers. */
  readonly registers: readonly string[];
  /** Only records no attempt has been started for yet. */
  readonly firstAttemptOnly?: boolean | undefined;
}

export interface ListFilter {
  readonly status?: readonly SaleStatus[] | undefined;
  readonly register?: string | undefined;
  /** `dat_trzby` from (inclusive). */
  readonly saleFrom?: number | undefined;
  /** `dat_trzby` to (exclusive). */
  readonly saleTo?: number | undefined;
  /** Only overdue records (true) or only the others (false); see `isOverdue`. */
  readonly overdue?: boolean | undefined;
  readonly now: number;
  readonly limit: number;
  /** `nextCursor` of the previous page. */
  readonly cursor?: string | undefined;
}

export interface ListPage {
  /** Newest first. */
  readonly items: SaleRecord[];
  readonly nextCursor?: string | undefined;
}

export interface QueueStore {
  /**
   * Stores a new record unless its idempotency key, or (outside verification mode) its sale key,
   * is already taken; the check and the insert are one atomic step.
   */
  insert(record: SaleRecord): Promise<InsertResult>;
  get(id: string): Promise<SaleRecord | undefined>;
  /** Attempts of one sale, by `n`. */
  attempts(saleId: string): Promise<AttemptRecord[]>;
  /**
   * Leases up to `limit` records that are due (`nextAttemptAt <= now`) and not leased, earliest
   * due first. No two callers ever get the same record.
   */
  claimDue(
    now: number,
    limit: number,
    leaseUntil: number,
    filter: ClaimFilter,
  ): Promise<SaleRecord[]>;
  /** Leases one record if nobody holds it, whatever its status. */
  claim(id: string, leaseUntil: number): Promise<SaleRecord | undefined>;
  /**
   * Write-ahead: records attempt `n` as started and sets the record's `attempts` and `uuid`.
   * Throws if `n` or `uuid_zpravy` is taken, or if the sale already has an attempt with
   * `prvni_zaslani = true` and this one has it too.
   */
  beginAttempt(attempt: AttemptStart): Promise<void>;
  /**
   * Closes open attempt `n` and replaces the record's state (which normally clears the lease).
   * Returns false and changes nothing when the attempt is already closed.
   */
  finishAttempt(saleId: string, n: number, end: AttemptEnd, state: SaleState): Promise<boolean>;
  /**
   * Replaces the state of a record without an open attempt, if it is still leased until exactly
   * `leaseUntil`. Returns false otherwise.
   */
  release(id: string, leaseUntil: number, state: SaleState): Promise<boolean>;
  /** Leased records whose lease ended before `now`: crashed or stuck attempts. */
  expiredLeases(now: number): Promise<SaleRecord[]>;
  list(filter: ListFilter): Promise<ListPage>;
}

const STATE_KEYS = [
  "status",
  "attempts",
  "nextAttemptAt",
  "leaseUntil",
  "updatedAt",
  "uuid",
  "pok",
  "test",
  "code",
  "message",
  "reason",
  "httpStatus",
  "globalTransactionId",
  "eetWarnings",
] as const satisfies readonly (keyof SaleState)[];

/** The state fields of a record, e.g. to derive a new state from it. */
export function stateOf(record: SaleRecord): SaleState {
  return Object.fromEntries(STATE_KEYS.map((key) => [key, record[key]])) as unknown as SaleState;
}

/** `record` with its state replaced by `state`; state fields absent from `state` become unset. */
export function withState(record: SaleRecord, state: SaleState): SaleRecord {
  return { ...record, ...Object.fromEntries(STATE_KEYS.map((key) => [key, state[key]])) };
}

/** Cursor of a page that ends with `record` (newest-first order: createdAt, then id). */
export function cursorOf(record: SaleRecord): string {
  return `${record.createdAt}.${record.id}`;
}

export function parseCursor(cursor: string): { createdAt: number; id: string } | undefined {
  const dot = cursor.indexOf(".");
  const createdAt = Number(cursor.slice(0, dot));
  if (dot < 1 || !Number.isSafeInteger(createdAt)) return undefined;
  return { createdAt, id: cursor.slice(dot + 1) };
}
