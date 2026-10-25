/**
 * Randomized runs (fixed seeds) of submits, failures, crashes and restarts against one SQLite
 * database. Whatever happens, the safety rules of ADR-003 must hold.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { TransportRequest } from "@eet-gateway/core";
import {
  type AttemptRecord,
  createEetQueue,
  createSqliteStore,
  type QueueStore,
  type SaleRecord,
} from "../src/index.ts";
import {
  accepted,
  DEFAULTS,
  input,
  notSent,
  rejected,
  scripted,
  T0,
  uncertain,
  verificationOk,
} from "./helpers.ts";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A process: the store as seen from it. Once dead, every store call fails. */
function processView(store: QueueStore) {
  const view = { dead: false, store: {} as QueueStore };
  for (const key of Object.keys(store) as (keyof QueueStore)[]) {
    (view.store as unknown as Record<string, unknown>)[key] = (...args: unknown[]) =>
      view.dead
        ? Promise.reject(new Error("process is dead"))
        : (store[key] as (...a: unknown[]) => unknown)(...args);
  }
  return view;
}

const SEEDS = [1, 2, 3, 42, 2026];

for (const seed of SEEDS) {
  test(`seed ${seed}: one first submission, unique UUIDs, unchanged Data, nothing after a POK`, async () => {
    const random = mulberry32(seed);
    const store = createSqliteStore(new Database(":memory:"));
    const sent: TransportRequest[] = [];
    let now = T0;
    let healthy = false;
    let current = processView(store);

    const transport = scripted();
    transport.fallback = (request) => {
      sent.push(structuredClone(request));
      if (healthy) return request.header.overeni ? verificationOk(request) : accepted(request);
      const roll = random();
      // The process dies after EET got the message but before the answer is stored.
      if (roll < 0.1) current.dead = true;
      const outcomes = [
        accepted,
        rejected(-1),
        rejected(8),
        rejected(4),
        notSent("network"),
        uncertain("timeout"),
        uncertain("http"),
        uncertain("signature"),
      ];
      const pick = outcomes[Math.floor(random() * outcomes.length)] ?? accepted;
      return request.header.overeni && pick === accepted ? verificationOk(request) : pick(request);
    };

    const boot = () =>
      createEetQueue({
        store: current.store,
        registers: { main: { transport, context: { register: DEFAULTS } } },
        now: () => now,
        random,
        concurrency: 3,
      });
    let queue = boot();

    for (let round = 0; round < 40; round++) {
      const action = random();
      if (action < 0.5) {
        const porad = `S-${Math.floor(random() * 12)}`; // collisions → duplicates and replays
        const options = {
          mode: random() < 0.5 ? ("async" as const) : ("sync" as const),
          verify: random() < 0.1,
          ...(random() < 0.3 ? { idempotencyKey: `key-${porad}` } : {}),
        };
        const extra = random() < 0.15 ? { prvni_zaslani: false } : {};
        await queue.submit(input(porad, extra), options).catch(() => undefined);
      } else if (action < 0.6) {
        const [record] = (await store.list({ now, limit: 1 })).items;
        if (record !== undefined) await queue.retry(record.id).catch(() => undefined);
      }
      now += Math.floor(random() * 400_000);
      await queue.runDue();
      if (current.dead) {
        // Restart: a new process over the same database.
        current = processView(store);
        queue = boot();
      }
    }

    // EET recovers; let every resend that is still planned finish.
    healthy = true;
    for (let i = 0; i < 12; i++) {
      now += 300_000;
      await queue.runDue();
    }

    const records: SaleRecord[] = [];
    for (let cursor: string | undefined, more = true; more; ) {
      const page = await store.list({ now, limit: 100, cursor });
      records.push(...page.items);
      cursor = page.nextCursor;
      more = cursor !== undefined;
    }
    expect(records.length).toBeGreaterThan(0);

    const uuids = new Set<string>();
    const attemptsByUuid = new Map<string, AttemptRecord>();
    for (const record of records) {
      const attempts = await store.attempts(record.id);
      expect(attempts.map((a) => a.n)).toEqual(attempts.map((_, i) => i + 1));
      // One first submission, only on attempt 1, never when the caller had sent it before.
      const firsts = attempts.filter((a) => a.prvni_zaslani);
      expect(firsts.length).toBeLessThanOrEqual(record.firstSubmission ? 1 : 0);
      if (firsts[0] !== undefined) expect(firsts[0].n).toBe(1);
      // Nothing after a POK or a verification answer.
      const done = attempts.findIndex(
        (a) => a.outcome === "accepted" || a.outcome === "verification_ok",
      );
      if (done !== -1) expect(done).toBe(attempts.length - 1);
      for (const attempt of attempts) {
        expect(uuids.has(attempt.uuid_zpravy)).toBe(false);
        uuids.add(attempt.uuid_zpravy);
        attemptsByUuid.set(attempt.uuid_zpravy, attempt);
        expect(attempt.finishedAt).toBeNumber(); // every crash was recovered
      }
      // A sale that can still be sent ends with a POK once EET is back.
      if (record.status === "queued" || (record.status === "uncertain" && record.nextAttemptAt))
        throw new Error(`${record.id} still pending: ${record.status}`);
    }

    const dataBySale = new Map(records.map((r) => [r.id, JSON.stringify(r.data)]));
    for (const request of sent) {
      // Write-ahead: every message that went out has its attempt record …
      const attempt = attemptsByUuid.get(request.header.uuid_zpravy);
      expect(attempt).toBeDefined();
      // … with the header it was sent with, and the sale's Data byte for byte.
      expect(attempt?.prvni_zaslani).toBe(request.header.prvni_zaslani);
      expect(JSON.stringify(request.data)).toBe(dataBySale.get(attempt?.saleId ?? "") as string);
    }
  });
}
