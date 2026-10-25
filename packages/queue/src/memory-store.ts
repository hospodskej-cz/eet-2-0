/**
 * In-memory `QueueStore`: the reference implementation of the store contract, for tests and
 * experiments. Everything is lost when the process ends — never use it to send real sales.
 */

import { isOverdue } from "./result.ts";
import {
  type AttemptEnd,
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
  withState,
} from "./store.ts";

const copy = <T>(value: T): T => structuredClone(value);

export function createMemoryStore(): QueueStore {
  const sales = new Map<string, SaleRecord>();
  const attempts = new Map<string, AttemptRecord[]>();
  const uuids = new Set<string>();

  const update = (id: string, state: SaleState) => {
    const record = sales.get(id);
    if (record !== undefined) sales.set(id, withState(record, copy(state)));
  };

  return {
    async insert(record): Promise<InsertResult> {
      for (const existing of sales.values()) {
        if (
          record.idempotencyKey !== undefined &&
          existing.idempotencyKey === record.idempotencyKey
        )
          return { inserted: false, existing: copy(existing), conflict: "idempotency_key" };
      }
      if (!record.verification) {
        for (const existing of sales.values()) {
          if (!existing.verification && existing.saleKey === record.saleKey)
            return { inserted: false, existing: copy(existing), conflict: "sale_key" };
        }
      }
      if (sales.has(record.id)) throw new Error(`duplicate sale id ${record.id}`);
      sales.set(record.id, copy(record));
      attempts.set(record.id, []);
      return { inserted: true };
    },

    async get(id) {
      const record = sales.get(id);
      return record === undefined ? undefined : copy(record);
    },

    async attempts(saleId) {
      return copy(attempts.get(saleId) ?? []);
    },

    async claimDue(now, limit, leaseUntil, filter: ClaimFilter) {
      const registers = new Set(filter.registers);
      const due = [...sales.values()]
        .filter(
          (r) =>
            r.nextAttemptAt !== undefined &&
            r.nextAttemptAt <= now &&
            r.leaseUntil === undefined &&
            registers.has(r.register) &&
            (!filter.firstAttemptOnly || r.attempts === 0),
        )
        .sort((a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0) || compare(a.id, b.id))
        .slice(0, limit);
      for (const record of due) sales.set(record.id, { ...record, leaseUntil, updatedAt: now });
      return due.map((r) => copy(sales.get(r.id) as SaleRecord));
    },

    async claim(id, leaseUntil) {
      const record = sales.get(id);
      if (record === undefined || record.leaseUntil !== undefined) return undefined;
      const claimed = { ...record, leaseUntil };
      sales.set(id, claimed);
      return copy(claimed);
    },

    async beginAttempt(attempt: AttemptStart) {
      const record = sales.get(attempt.saleId);
      const list = attempts.get(attempt.saleId);
      if (record === undefined || list === undefined)
        throw new Error(`unknown sale ${attempt.saleId}`);
      if (list.some((a) => a.n === attempt.n)) throw new Error(`attempt ${attempt.n} exists`);
      if (uuids.has(attempt.uuid_zpravy)) throw new Error("uuid_zpravy already used");
      if (attempt.prvni_zaslani && list.some((a) => a.prvni_zaslani))
        throw new Error("second attempt with prvni_zaslani=true");
      uuids.add(attempt.uuid_zpravy);
      list.push(copy(attempt));
      sales.set(record.id, { ...record, attempts: attempt.n, uuid: attempt.uuid_zpravy });
    },

    async finishAttempt(saleId, n, end: AttemptEnd, state) {
      const list = attempts.get(saleId) ?? [];
      const index = list.findIndex((a) => a.n === n && a.finishedAt === undefined);
      const open = list[index];
      if (open === undefined) return false;
      list[index] = { ...open, ...copy(end) };
      update(saleId, state);
      return true;
    },

    async release(id, leaseUntil, state) {
      if (sales.get(id)?.leaseUntil !== leaseUntil) return false;
      update(id, state);
      return true;
    },

    async expiredLeases(now) {
      return [...sales.values()]
        .filter((r) => r.leaseUntil !== undefined && r.leaseUntil < now)
        .map(copy);
    },

    async list(filter: ListFilter): Promise<ListPage> {
      const after = filter.cursor === undefined ? undefined : parseCursor(filter.cursor);
      if (filter.cursor !== undefined && after === undefined)
        throw new RangeError("invalid cursor");
      const statuses = filter.status === undefined ? undefined : new Set(filter.status);
      const items = [...sales.values()]
        .filter(
          (r) =>
            (statuses === undefined || statuses.has(r.status)) &&
            (filter.register === undefined || r.register === filter.register) &&
            (filter.saleFrom === undefined || r.saleAt >= filter.saleFrom) &&
            (filter.saleTo === undefined || r.saleAt < filter.saleTo) &&
            (filter.overdue === undefined || isOverdue(r, filter.now) === filter.overdue) &&
            (after === undefined ||
              r.createdAt < after.createdAt ||
              (r.createdAt === after.createdAt && compare(r.id, after.id) < 0)),
        )
        .sort((a, b) => b.createdAt - a.createdAt || compare(b.id, a.id));
      const page = items.slice(0, filter.limit).map(copy);
      const last = page.at(-1);
      return items.length > filter.limit && last !== undefined
        ? { items: page, nextCursor: cursorOf(last) }
        : { items: page };
    },
  };
}

/** Byte order, like SQLite's default BINARY collation. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
