/**
 * The `QueueStore` contract: every store implementation (memory, SQLite, a future Postgres one)
 * must pass these tests unchanged.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { AttemptStart, QueueStore, SaleRecord, SaleState } from "../src/index.ts";
import { withState } from "../src/store.ts";

const T0 = Date.parse("2026-10-25T17:00:00Z");
let serial = 0;

export function makeRecord(overrides: Partial<SaleRecord> = {}): SaleRecord {
  serial += 1;
  const porad = `R-${serial}`;
  return {
    id: `sale-${String(serial).padStart(4, "0")}`,
    register: "main",
    saleKey: `CZ00000019|11|P1|${porad}|2026-10-25T18:00:00+01:00|100.00`,
    verification: false,
    firstSubmission: true,
    data: {
      eic_popl: "CZ00000019",
      id_jednotky: "11",
      id_pokl: "P1",
      porad_cis: porad,
      dat_trzby: "2026-10-25T18:00:00+01:00",
      celk_trzba: "100.00",
      urceno_cerp_zuct: "12.00",
      povereni_vice_popl: false,
    },
    ingestWarnings: [{ code: 1021, message: "default", source: "ingest", field: "eic_popl" }],
    saleAt: T0,
    deadlineAt: T0 + 48 * 3_600_000,
    createdAt: T0 + serial,
    status: "queued",
    attempts: 0,
    nextAttemptAt: T0,
    updatedAt: T0,
    eetWarnings: [],
    ...overrides,
  };
}

function start(record: SaleRecord, n: number, overrides: Partial<AttemptStart> = {}): AttemptStart {
  return {
    saleId: record.id,
    n,
    uuid_zpravy: crypto.randomUUID(),
    dat_odesl: "2026-10-25T18:00:01+01:00",
    prvni_zaslani: n === 1,
    overeni: false,
    environment: "playground",
    endpoint: "https://pg.example/eet",
    startedAt: T0 + n,
    ...overrides,
  };
}

const settled = (record: SaleRecord, overrides: Partial<SaleState> = {}): SaleState => ({
  status: "accepted",
  attempts: record.attempts,
  updatedAt: T0 + 1_000,
  pok: "pok-ff",
  test: true,
  httpStatus: 200,
  globalTransactionId: "gtid",
  eetWarnings: [{ code: 6, message: "id_jednotky" }],
  ...overrides,
});

export function storeContract(name: string, makeStore: () => QueueStore | Promise<QueueStore>) {
  describe(`QueueStore contract: ${name}`, () => {
    let store: QueueStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    test("insert and get round-trip every field", async () => {
      const record = makeRecord({
        idempotencyKey: "k-1",
        eetWarnings: [{ code: 4, message: "x" }],
      });
      expect(await store.insert(record)).toEqual({ inserted: true });
      expect(await store.get(record.id)).toEqual(record);
      expect(await store.get("missing")).toBeUndefined();
      // Returned records are copies.
      const copy = (await store.get(record.id)) as { data: { celk_trzba: string } };
      copy.data.celk_trzba = "1.00";
      expect((await store.get(record.id))?.data.celk_trzba).toBe("100.00");
    });

    test("an idempotency key is taken once", async () => {
      const first = makeRecord({ idempotencyKey: "same" });
      await store.insert(first);
      const second = makeRecord({ idempotencyKey: "same" });
      expect(await store.insert(second)).toEqual({
        inserted: false,
        existing: first,
        conflict: "idempotency_key",
      });
      expect(await store.get(second.id)).toBeUndefined();
    });

    test("a sale key is taken once outside verification mode", async () => {
      const live = makeRecord();
      await store.insert(live);
      expect(await store.insert(makeRecord({ saleKey: live.saleKey }))).toMatchObject({
        inserted: false,
        existing: { id: live.id },
        conflict: "sale_key",
      });
      // Verification messages register nothing: they neither block nor are blocked.
      const check1 = makeRecord({ saleKey: live.saleKey, verification: true });
      const check2 = makeRecord({ saleKey: live.saleKey, verification: true });
      expect(await store.insert(check1)).toEqual({ inserted: true });
      expect(await store.insert(check2)).toEqual({ inserted: true });
      const other = makeRecord();
      const otherCheck = makeRecord({ saleKey: other.saleKey, verification: true });
      expect(await store.insert(otherCheck)).toEqual({ inserted: true });
      expect(await store.insert(other)).toEqual({ inserted: true });
    });

    test("claimDue leases due, unleased records of the given registers, earliest first", async () => {
      const late = makeRecord({ nextAttemptAt: T0 + 50 });
      const early = makeRecord({ nextAttemptAt: T0 + 10 });
      const future = makeRecord({ nextAttemptAt: T0 + 10_000 });
      const none = makeRecord({ nextAttemptAt: undefined, status: "accepted" });
      const leased = makeRecord({ nextAttemptAt: T0, leaseUntil: T0 + 5_000 });
      const elsewhere = makeRecord({ register: "other", nextAttemptAt: T0 });
      for (const r of [late, early, future, none, leased, elsewhere]) await store.insert(r);

      const now = T0 + 100;
      const claimed = await store.claimDue(now, 10, now + 120_000, { registers: ["main"] });
      expect(claimed.map((r) => r.id)).toEqual([early.id, late.id]);
      expect(claimed.every((r) => r.leaseUntil === now + 120_000)).toBe(true);
      expect((await store.get(early.id))?.leaseUntil).toBe(now + 120_000);
      expect(await store.claimDue(now, 10, now + 120_000, { registers: ["main"] })).toEqual([]);
      expect(await store.claimDue(now, 10, now, { registers: [] })).toEqual([]);
    });

    test("claimDue respects the limit and firstAttemptOnly", async () => {
      const resend = makeRecord({ attempts: 2, nextAttemptAt: T0 });
      const fresh1 = makeRecord({ nextAttemptAt: T0 + 1 });
      const fresh2 = makeRecord({ nextAttemptAt: T0 + 2 });
      for (const r of [resend, fresh1, fresh2]) await store.insert(r);
      const firsts = await store.claimDue(T0 + 10, 1, T0 + 999, {
        registers: ["main"],
        firstAttemptOnly: true,
      });
      expect(firsts.map((r) => r.id)).toEqual([fresh1.id]);
      const rest = await store.claimDue(T0 + 10, 5, T0 + 999, { registers: ["main"] });
      expect(rest.map((r) => r.id)).toEqual([resend.id, fresh2.id]);
    });

    test("claim takes an unleased record once, whatever its status", async () => {
      const record = makeRecord({ status: "rejected", nextAttemptAt: undefined });
      await store.insert(record);
      expect((await store.claim(record.id, T0 + 1))?.leaseUntil).toBe(T0 + 1);
      expect(await store.claim(record.id, T0 + 2)).toBeUndefined();
      expect(await store.claim("missing", T0)).toBeUndefined();
    });

    test("an attempt is written ahead, then closed exactly once", async () => {
      const record = makeRecord({ leaseUntil: T0 + 1 });
      await store.insert(record);
      const first = start(record, 1);
      await store.beginAttempt(first);
      expect(await store.get(record.id)).toMatchObject({
        attempts: 1,
        uuid: first.uuid_zpravy,
        leaseUntil: T0 + 1,
      });
      expect(await store.attempts(record.id)).toEqual([first]);

      const state = settled({ ...record, attempts: 1 }, { uuid: first.uuid_zpravy });
      const end = {
        finishedAt: T0 + 900,
        outcome: "accepted" as const,
        pok: "pok-ff",
        httpStatus: 200,
        durationMs: 199,
      };
      expect(await store.finishAttempt(record.id, 1, end, state)).toBe(true);
      expect(await store.finishAttempt(record.id, 1, end, { ...state, status: "rejected" })).toBe(
        false,
      );
      expect(await store.get(record.id)).toEqual(withState({ ...record, attempts: 1 }, state));
      expect(await store.attempts(record.id)).toEqual([{ ...first, ...end }]);
    });

    test("attempts list in order with open and closed ones", async () => {
      const record = makeRecord();
      await store.insert(record);
      const a1 = start(record, 1);
      const a2 = start(record, 2);
      await store.beginAttempt(a1);
      await store.finishAttempt(
        record.id,
        1,
        { finishedAt: T0 + 5, outcome: "uncertain", reason: "timeout", message: "late" },
        settled(record, { status: "uncertain", attempts: 1, nextAttemptAt: T0 + 6 }),
      );
      await store.beginAttempt(a2);
      const attempts = await store.attempts(record.id);
      expect(attempts.map((a) => [a.n, a.outcome, a.prvni_zaslani])).toEqual([
        [1, "uncertain", true],
        [2, undefined, false],
      ]);
      expect((await store.get(record.id))?.attempts).toBe(2);
    });

    test("never two first submissions, never a reused UUID or attempt number", async () => {
      const record = makeRecord();
      await store.insert(record);
      const a1 = start(record, 1);
      await store.beginAttempt(a1);
      expect(store.beginAttempt(start(record, 2, { prvni_zaslani: true }))).rejects.toThrow();
      expect(store.beginAttempt(start(record, 1, { prvni_zaslani: false }))).rejects.toThrow();
      expect(
        store.beginAttempt(start(record, 2, { uuid_zpravy: a1.uuid_zpravy })),
      ).rejects.toThrow();
      expect((await store.attempts(record.id)).length).toBe(1);
      expect((await store.get(record.id))?.attempts).toBe(1);
    });

    test("release only applies while the expected lease is held", async () => {
      const record = makeRecord({ leaseUntil: T0 + 50 });
      await store.insert(record);
      const state = { ...settled(record), status: "queued" as const, leaseUntil: undefined };
      expect(await store.release(record.id, T0 + 49, state)).toBe(false);
      expect(await store.release(record.id, T0 + 50, state)).toBe(true);
      expect((await store.get(record.id))?.leaseUntil).toBeUndefined();
      expect(await store.release(record.id, T0 + 50, state)).toBe(false);
    });

    test("expiredLeases finds leases that ran out", async () => {
      const expired = makeRecord({ leaseUntil: T0 + 10 });
      const live = makeRecord({ leaseUntil: T0 + 1_000 });
      const free = makeRecord();
      for (const r of [expired, live, free]) await store.insert(r);
      expect((await store.expiredLeases(T0 + 100)).map((r) => r.id)).toEqual([expired.id]);
    });

    test("list filters, orders newest first and pages with a cursor", async () => {
      const deadline = T0 + 48 * 3_600_000;
      const records = [
        makeRecord({ status: "accepted", saleAt: T0 }),
        makeRecord({ status: "queued", saleAt: T0 + 1_000 }),
        makeRecord({ status: "uncertain", saleAt: T0 + 2_000, register: "other" }),
        makeRecord({ status: "rejected", saleAt: T0 + 3_000 }),
        makeRecord({
          status: "queued",
          saleAt: T0 + 4_000,
          verification: true,
          deadlineAt: undefined,
        }),
      ];
      for (const r of records) await store.insert(r);
      const ids = (page: { items: SaleRecord[] }) => page.items.map((r) => r.id);
      const all = { now: T0, limit: 50 };
      const [r0, r1, r2, r3, r4] = records.map((r) => r.id) as [
        string,
        string,
        string,
        string,
        string,
      ];

      expect(ids(await store.list(all))).toEqual([r4, r3, r2, r1, r0]);
      expect(ids(await store.list({ ...all, status: ["queued", "rejected"] }))).toEqual([
        r4,
        r3,
        r1,
      ]);
      expect(ids(await store.list({ ...all, status: [] }))).toEqual([]);
      expect(ids(await store.list({ ...all, register: "other" }))).toEqual([r2]);
      expect(ids(await store.list({ ...all, saleFrom: T0 + 1_000, saleTo: T0 + 3_000 }))).toEqual([
        r2,
        r1,
      ]);
      // Overdue: past the deadline, no POK, not a verification message.
      expect(ids(await store.list({ ...all, now: deadline + 1, overdue: true }))).toEqual([
        r3,
        r2,
        r1,
      ]);
      expect(ids(await store.list({ ...all, now: deadline + 1, overdue: false }))).toEqual([
        r4,
        r0,
      ]);
      expect(ids(await store.list({ ...all, now: deadline, overdue: true }))).toEqual([]);

      const page1 = await store.list({ ...all, limit: 2 });
      expect(ids(page1)).toEqual([r4, r3]);
      const page2 = await store.list({ ...all, limit: 2, cursor: page1.nextCursor });
      expect(ids(page2)).toEqual([r2, r1]);
      const page3 = await store.list({ ...all, limit: 2, cursor: page2.nextCursor });
      expect(ids(page3)).toEqual([r0]);
      expect(page3.nextCursor).toBeUndefined();
      expect(store.list({ ...all, cursor: "nonsense" })).rejects.toThrow(RangeError);
    });
  });
}
