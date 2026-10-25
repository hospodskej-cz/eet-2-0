/**
 * SQLite `QueueStore`. Takes an open database from the caller — `bun:sqlite` `Database` on Bun,
 * `node:sqlite` `DatabaseSync` on Node 22.13+ and Deno 2.2+ — so the queue itself imports no
 * runtime-specific module. Every operation is one synchronous transaction; the single-statement
 * claim is atomic even with several processes on one file. Schema: docs/QUEUE.md.
 */
import { compact } from "./result.ts";
import {
  type AttemptEnd,
  type AttemptOutcome,
  type AttemptRecord,
  type AttemptStart,
  type ClaimFilter,
  cursorOf,
  type InsertResult,
  type ListFilter,
  type ListPage,
  parseCursor,
  type QueueStore,
  type SaleRecord,
  type SaleState,
} from "./store.ts";

export type SqliteValue = string | number | bigint | null | Uint8Array;

/** The part of `bun:sqlite` `Database` and `node:sqlite` `DatabaseSync` this store uses. */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

export interface SqliteStatement {
  run(...params: SqliteValue[]): unknown;
  get(...params: SqliteValue[]): unknown;
  all(...params: SqliteValue[]): unknown[];
}

const SCHEMA_VERSION = 1;

// STRICT tables need SQLite 3.37+, RETURNING 3.35+.
const SCHEMA = `
CREATE TABLE eet_sales (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  sale_key TEXT NOT NULL,
  verification INTEGER NOT NULL,
  first_submission INTEGER NOT NULL,
  data TEXT NOT NULL,
  ingest_warnings TEXT NOT NULL,
  sale_at INTEGER NOT NULL,
  deadline_at INTEGER,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_attempt_at INTEGER,
  lease_until INTEGER,
  updated_at INTEGER NOT NULL,
  uuid TEXT,
  pok TEXT,
  test INTEGER,
  code INTEGER,
  message TEXT,
  reason TEXT,
  http_status INTEGER,
  global_transaction_id TEXT,
  eet_warnings TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX eet_sales_sale_key ON eet_sales (sale_key) WHERE verification = 0;
CREATE INDEX eet_sales_due ON eet_sales (next_attempt_at) WHERE next_attempt_at IS NOT NULL;
CREATE INDEX eet_sales_lease ON eet_sales (lease_until) WHERE lease_until IS NOT NULL;
CREATE INDEX eet_sales_created ON eet_sales (created_at, id);
CREATE TABLE eet_attempts (
  sale_id TEXT NOT NULL REFERENCES eet_sales (id),
  n INTEGER NOT NULL,
  uuid_zpravy TEXT NOT NULL UNIQUE,
  dat_odesl TEXT NOT NULL,
  prvni_zaslani INTEGER NOT NULL,
  overeni INTEGER NOT NULL,
  environment TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT,
  reason TEXT,
  code INTEGER,
  message TEXT,
  pok TEXT,
  http_status INTEGER,
  global_transaction_id TEXT,
  duration_ms INTEGER,
  PRIMARY KEY (sale_id, n)
) STRICT;
-- At most one first submission per sale (metodika 1.3), enforced by the database itself.
CREATE UNIQUE INDEX eet_attempts_first ON eet_attempts (sale_id) WHERE prvni_zaslani = 1;
`;

const STATE_COLUMNS = [
  "status",
  "attempts",
  "next_attempt_at",
  "lease_until",
  "updated_at",
  "uuid",
  "pok",
  "test",
  "code",
  "message",
  "reason",
  "http_status",
  "global_transaction_id",
  "eet_warnings",
] as const;
const SET_STATE = STATE_COLUMNS.map((c) => `${c} = ?`).join(", ");

type Row = Record<string, unknown>;

/**
 * Creates the tables on first use (tracked in `eet_queue_meta`, so the queue can share a database
 * with the application) and switches the connection to WAL with `synchronous = FULL`: a committed
 * write-ahead record survives a crash of the process and of the machine.
 */
export function createSqliteStore(db: SqliteDatabase): QueueStore {
  const statements = new Map<string, SqliteStatement>();
  const sql = (text: string) => {
    let statement = statements.get(text);
    if (statement === undefined) {
      statement = db.prepare(text);
      statements.set(text, statement);
    }
    return statement;
  };
  const transaction = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS eet_queue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const row = sql("SELECT value FROM eet_queue_meta WHERE key = 'schema_version'").get() as
      | Row
      | null
      | undefined;
    const version = row == null ? 0 : Number(row["value"]);
    if (version > SCHEMA_VERSION)
      throw new Error(`queue schema ${version} is newer than this library (${SCHEMA_VERSION})`);
    if (version === 0) {
      db.exec(SCHEMA);
      sql("INSERT INTO eet_queue_meta (key, value) VALUES ('schema_version', ?)").run(
        String(SCHEMA_VERSION),
      );
    }
  });

  const getSale = (id: string) => {
    const row = sql("SELECT * FROM eet_sales WHERE id = ?").get(id) as Row | null | undefined;
    return row == null ? undefined : saleFromRow(row);
  };
  const changes = (result: unknown) => Number((result as { changes: number | bigint }).changes);

  return {
    async insert(record): Promise<InsertResult> {
      return transaction(() => {
        if (record.idempotencyKey !== undefined) {
          const row = sql("SELECT * FROM eet_sales WHERE idempotency_key = ?").get(
            record.idempotencyKey,
          ) as Row | null | undefined;
          if (row != null)
            return { inserted: false, existing: saleFromRow(row), conflict: "idempotency_key" };
        }
        if (!record.verification) {
          const row = sql("SELECT * FROM eet_sales WHERE sale_key = ? AND verification = 0").get(
            record.saleKey,
          ) as Row | null | undefined;
          if (row != null)
            return { inserted: false, existing: saleFromRow(row), conflict: "sale_key" };
        }
        sql(
          `INSERT INTO eet_sales (id, register_id, idempotency_key, sale_key, verification,
             first_submission, data, ingest_warnings, sale_at, deadline_at, created_at,
             ${STATE_COLUMNS.join(", ")})
           VALUES (${Array(11 + STATE_COLUMNS.length)
             .fill("?")
             .join(", ")})`,
        ).run(
          record.id,
          record.register,
          record.idempotencyKey ?? null,
          record.saleKey,
          bool(record.verification),
          bool(record.firstSubmission),
          JSON.stringify(record.data),
          JSON.stringify(record.ingestWarnings),
          record.saleAt,
          record.deadlineAt ?? null,
          record.createdAt,
          ...stateValues(record),
        );
        return { inserted: true };
      });
    },

    async get(id) {
      return getSale(id);
    },

    async attempts(saleId) {
      const rows = sql("SELECT * FROM eet_attempts WHERE sale_id = ? ORDER BY n").all(saleId);
      return (rows as Row[]).map(attemptFromRow);
    },

    async claimDue(now, limit, leaseUntil, filter: ClaimFilter) {
      if (filter.registers.length === 0 || limit < 1) return [];
      const rows = sql(
        `UPDATE eet_sales SET lease_until = ?, updated_at = ?
         WHERE id IN (
           SELECT id FROM eet_sales
           WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= ? AND lease_until IS NULL
             AND register_id IN (${filter.registers.map(() => "?").join(", ")})
             ${filter.firstAttemptOnly ? "AND attempts = 0" : ""}
           ORDER BY next_attempt_at, id LIMIT ?)
         RETURNING *`,
      ).all(leaseUntil, now, now, ...filter.registers, limit) as Row[];
      return rows
        .map(saleFromRow)
        .sort((a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0) || (a.id < b.id ? -1 : 1));
    },

    async claim(id, leaseUntil) {
      const row = sql(
        "UPDATE eet_sales SET lease_until = ? WHERE id = ? AND lease_until IS NULL RETURNING *",
      ).get(leaseUntil, id) as Row | null | undefined;
      return row == null ? undefined : saleFromRow(row);
    },

    async beginAttempt(attempt: AttemptStart) {
      transaction(() => {
        sql(
          `INSERT INTO eet_attempts (sale_id, n, uuid_zpravy, dat_odesl, prvni_zaslani, overeni,
             environment, endpoint, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          attempt.saleId,
          attempt.n,
          attempt.uuid_zpravy,
          attempt.dat_odesl,
          bool(attempt.prvni_zaslani),
          bool(attempt.overeni),
          attempt.environment,
          attempt.endpoint,
          attempt.startedAt,
        );
        sql("UPDATE eet_sales SET attempts = ?, uuid = ? WHERE id = ?").run(
          attempt.n,
          attempt.uuid_zpravy,
          attempt.saleId,
        );
      });
    },

    async finishAttempt(saleId, n, end: AttemptEnd, state) {
      return transaction(() => {
        const closed = sql(
          `UPDATE eet_attempts SET finished_at = ?, outcome = ?, reason = ?, code = ?, message = ?,
             pok = ?, http_status = ?, global_transaction_id = ?, duration_ms = ?
           WHERE sale_id = ? AND n = ? AND finished_at IS NULL`,
        ).run(
          end.finishedAt,
          end.outcome,
          end.reason ?? null,
          end.code ?? null,
          end.message ?? null,
          end.pok ?? null,
          end.httpStatus ?? null,
          end.globalTransactionId ?? null,
          end.durationMs ?? null,
          saleId,
          n,
        );
        if (changes(closed) === 0) return false;
        sql(`UPDATE eet_sales SET ${SET_STATE} WHERE id = ?`).run(...stateValues(state), saleId);
        return true;
      });
    },

    async release(id, leaseUntil, state) {
      const result = sql(`UPDATE eet_sales SET ${SET_STATE} WHERE id = ? AND lease_until = ?`).run(
        ...stateValues(state),
        id,
        leaseUntil,
      );
      return changes(result) > 0;
    },

    async expiredLeases(now) {
      const rows = sql(
        "SELECT * FROM eet_sales WHERE lease_until IS NOT NULL AND lease_until < ? ORDER BY lease_until",
      ).all(now) as Row[];
      return rows.map(saleFromRow);
    },

    async list(filter: ListFilter): Promise<ListPage> {
      const where: string[] = [];
      const params: SqliteValue[] = [];
      if (filter.status !== undefined) {
        where.push(`status IN (${filter.status.map(() => "?").join(", ") || "NULL"})`);
        params.push(...filter.status);
      }
      if (filter.register !== undefined) {
        where.push("register_id = ?");
        params.push(filter.register);
      }
      if (filter.saleFrom !== undefined) {
        where.push("sale_at >= ?");
        params.push(filter.saleFrom);
      }
      if (filter.saleTo !== undefined) {
        where.push("sale_at < ?");
        params.push(filter.saleTo);
      }
      if (filter.overdue !== undefined) {
        const overdue =
          "(deadline_at IS NOT NULL AND deadline_at < ? AND status NOT IN ('accepted', 'verification_ok'))";
        where.push(filter.overdue ? overdue : `NOT ${overdue}`);
        params.push(filter.now);
      }
      if (filter.cursor !== undefined) {
        const after = parseCursor(filter.cursor);
        if (after === undefined) throw new RangeError("invalid cursor");
        where.push("(created_at < ? OR (created_at = ? AND id < ?))");
        params.push(after.createdAt, after.createdAt, after.id);
      }
      const rows = sql(
        `SELECT * FROM eet_sales ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(...params, filter.limit + 1) as Row[];
      const items = rows.slice(0, filter.limit).map(saleFromRow);
      const last = items.at(-1);
      return rows.length > filter.limit && last !== undefined
        ? { items, nextCursor: cursorOf(last) }
        : { items };
    },
  };
}

const bool = (value: boolean) => (value ? 1 : 0);
const optional = <T>(value: unknown, map: (v: unknown) => T): T | undefined =>
  value === null || value === undefined ? undefined : map(value);
const text = (value: unknown) => String(value);
const int = (value: unknown) => Number(value);

function stateValues(state: SaleState): SqliteValue[] {
  return [
    state.status,
    state.attempts,
    state.nextAttemptAt ?? null,
    state.leaseUntil ?? null,
    state.updatedAt,
    state.uuid ?? null,
    state.pok ?? null,
    state.test === undefined ? null : bool(state.test),
    state.code ?? null,
    state.message ?? null,
    state.reason ?? null,
    state.httpStatus ?? null,
    state.globalTransactionId ?? null,
    JSON.stringify(state.eetWarnings),
  ];
}

function saleFromRow(row: Row): SaleRecord {
  return {
    id: text(row["id"]),
    register: text(row["register_id"]),
    idempotencyKey: optional(row["idempotency_key"], text),
    saleKey: text(row["sale_key"]),
    verification: int(row["verification"]) === 1,
    firstSubmission: int(row["first_submission"]) === 1,
    data: JSON.parse(text(row["data"])),
    ingestWarnings: JSON.parse(text(row["ingest_warnings"])),
    saleAt: int(row["sale_at"]),
    deadlineAt: optional(row["deadline_at"], int),
    createdAt: int(row["created_at"]),
    status: text(row["status"]) as SaleRecord["status"],
    attempts: int(row["attempts"]),
    nextAttemptAt: optional(row["next_attempt_at"], int),
    leaseUntil: optional(row["lease_until"], int),
    updatedAt: int(row["updated_at"]),
    uuid: optional(row["uuid"], text),
    pok: optional(row["pok"], text),
    test: optional(row["test"], (v) => int(v) === 1),
    code: optional(row["code"], int),
    message: optional(row["message"], text),
    reason: optional(row["reason"], text),
    httpStatus: optional(row["http_status"], int),
    globalTransactionId: optional(row["global_transaction_id"], text),
    eetWarnings: JSON.parse(text(row["eet_warnings"])),
  };
}

function attemptFromRow(row: Row): AttemptRecord {
  return compact({
    saleId: text(row["sale_id"]),
    n: int(row["n"]),
    uuid_zpravy: text(row["uuid_zpravy"]),
    dat_odesl: text(row["dat_odesl"]),
    prvni_zaslani: int(row["prvni_zaslani"]) === 1,
    overeni: int(row["overeni"]) === 1,
    environment: text(row["environment"]) as AttemptRecord["environment"],
    endpoint: text(row["endpoint"]),
    startedAt: int(row["started_at"]),
    finishedAt: optional(row["finished_at"], int),
    outcome: optional(row["outcome"], (v) => text(v) as AttemptOutcome),
    reason: optional(row["reason"], text),
    code: optional(row["code"], int),
    message: optional(row["message"], text),
    pok: optional(row["pok"], text),
    httpStatus: optional(row["http_status"], int),
    globalTransactionId: optional(row["global_transaction_id"], text),
    durationMs: optional(row["duration_ms"], int),
  }) as AttemptRecord;
}
