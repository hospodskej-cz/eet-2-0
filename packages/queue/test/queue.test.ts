import { describe, expect, test } from "bun:test";
import {
  createEetQueue,
  createMemoryStore,
  QueueError,
  type QueueStore,
  QueueWarningCode,
  SaleResultSchema,
} from "../src/index.ts";
import {
  accepted,
  blocking,
  DEFAULTS,
  ENDPOINT,
  input,
  notSent,
  rejected,
  scripted,
  setup,
  T0,
  uncertain,
  verificationOk,
} from "./helpers.ts";

const codes = (result: { warnings: { code: number }[] }) => result.warnings.map((w) => w.code);

describe("submit — sync", () => {
  test("stores, sends once and returns the EET answer", async () => {
    const { queue, transport, store } = setup();
    const result = await queue.submit(input());
    expect(SaleResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      status: "accepted",
      register: "main",
      test: true,
      attempts: 1,
      httpStatus: 200,
      globalTransactionId: "gtid-1",
      overdue: false,
    });
    expect(result.pok).toBe(`${result.uuid}-ff`);
    expect(result.nextAttemptAt).toBeUndefined();
    expect(codes(result)).toEqual([1021, 1021, 1021]); // register defaults applied

    const [request] = transport.requests;
    expect(request?.header).toMatchObject({ prvni_zaslani: true, uuid_zpravy: result.uuid });
    expect(request?.header.overeni).toBeUndefined();
    expect(request?.header.dat_odesl).toBe("2026-10-25T18:00:00+01:00");
    expect(request?.data).toEqual({ ...DEFAULTS, ...input() });

    expect(await queue.get(result.id as string)).toEqual(result);
    const attempts = await store.attempts(result.id as string);
    expect(attempts).toMatchObject([{ n: 1, outcome: "accepted", prvni_zaslani: true }]);
  });

  test("writes the attempt ahead before anything is sent", async () => {
    let seen: unknown;
    const store = createMemoryStore();
    const transport = scripted([
      async (request) => {
        const [record] = (await store.list({ now: T0, limit: 1 })).items;
        seen = { record, attempts: await store.attempts(record?.id ?? "") };
        return accepted(request);
      },
    ]);
    const { queue } = setup({ transport, store });
    await queue.submit(input());
    expect(seen).toMatchObject({
      record: { status: "queued", attempts: 1, leaseUntil: T0 + 120_000 },
      attempts: [{ n: 1, prvni_zaslani: true }],
    });
    expect((seen as { attempts: { outcome?: string }[] }).attempts[0]?.outcome).toBeUndefined();
  });

  test("verification mode: overeni=true, verification_ok, no deadline", async () => {
    const { queue, transport } = setup({ transport: scripted([verificationOk]) });
    const result = await queue.submit(input(), { verify: true });
    expect(result).toMatchObject({ status: "verification_ok", attempts: 1 });
    expect(result.overdue).toBeUndefined();
    expect(transport.requests[0]?.header.overeni).toBe(true);
  });

  test("a sale the caller already tried to send goes out with prvni_zaslani=false", async () => {
    const { queue, transport } = setup();
    await queue.submit(input("U-1", { prvni_zaslani: false }));
    expect(transport.requests[0]?.header.prvni_zaslani).toBe(false);
  });

  test("debug output is returned once, never stored or put in events", async () => {
    const transport = scripted([
      (request) => {
        const outcome = accepted(request) as Extract<ReturnType<typeof accepted>, { kind: string }>;
        return {
          ...outcome,
          meta: {
            durationMs: 1,
            rawRequest: "<SignatureValue>[redacted]</SignatureValue>",
            rawResponse: "<x/>",
          },
        } as never;
      },
    ]);
    const { queue, events } = setup({ transport });
    const result = await queue.submit(input());
    expect(result.rawRequest).toContain("[redacted]");
    expect(result.rawResponse).toBe("<x/>");
    const stored = await queue.get(result.id as string);
    expect(stored?.rawRequest).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("redacted");
  });
});

describe("submit — async", () => {
  test("returns queued at once and sends in the background", async () => {
    const { queue, transport } = setup();
    const result = await queue.submit(input(), { mode: "async" });
    expect(result).toMatchObject({ status: "queued", attempts: 0 });
    expect(result.nextAttemptAt).toBe(new Date(T0).toISOString());
    await queue.runDue();
    expect(transport.requests).toHaveLength(1);
    expect(await queue.get(result.id as string)).toMatchObject({ status: "accepted", attempts: 1 });
  });

  test("start() sends, stop() waits for running attempts", async () => {
    const { queue, transport } = setup();
    queue.start();
    const result = await queue.submit(input(), { mode: "async" });
    await queue.stop();
    expect(transport.requests).toHaveLength(1);
    expect((await queue.get(result.id as string))?.status).toBe("accepted");
    // After stop(), async sales wait for the next start() or runDue().
    const later = await queue.submit(input("U-2"), { mode: "async" });
    await Promise.resolve();
    expect(transport.requests).toHaveLength(1);
    await queue.runDue();
    expect((await queue.get(later.id as string))?.status).toBe("accepted");
  });
});

describe("resending (metodika 1.3, ZoET §20)", () => {
  test("timeout → uncertain, resent with a new UUID, new dat_odesl, prvni_zaslani=false, same Data", async () => {
    const { queue, transport, clock } = setup({ transport: scripted([uncertain("timeout")]) });
    const first = await queue.submit(input());
    expect(first).toMatchObject({ status: "uncertain", reason: "timeout", attempts: 1 });
    expect(first.nextAttemptAt).toBe(new Date(T0 + 5_000).toISOString());

    await queue.runDue(); // not due yet
    expect(transport.requests).toHaveLength(1);
    clock.advance(5_000);
    await queue.runDue();
    const done = await queue.get(first.id as string);
    expect(done).toMatchObject({ status: "accepted", attempts: 2 });

    const [a, b] = transport.requests;
    expect(b?.header.prvni_zaslani).toBe(false);
    expect(b?.header.uuid_zpravy).not.toBe(a?.header.uuid_zpravy);
    expect(b?.header.dat_odesl).toBe("2026-10-25T18:00:05+01:00");
    expect(JSON.stringify(b?.data)).toBe(JSON.stringify(a?.data));
    expect(done?.uuid).toBe(b?.header.uuid_zpravy);
  });

  test("a first attempt that could not connect is still the only first submission", async () => {
    const { queue, transport, clock } = setup({ transport: scripted([notSent("network")]) });
    const first = await queue.submit(input());
    expect(first).toMatchObject({ status: "queued", reason: "network", attempts: 1 });
    clock.advance(5_000);
    await queue.runDue();
    expect(transport.requests.map((r) => r.header.prvni_zaslani)).toEqual([true, false]);
  });

  test("backoff doubles between failures", async () => {
    const { queue, clock } = setup({
      transport: scripted([notSent(), notSent(), notSent(), notSent()]),
    });
    const { id } = await queue.submit(input());
    const delays: number[] = [];
    let at = T0;
    for (let i = 0; i < 3; i++) {
      const next = Date.parse((await queue.get(id as string))?.nextAttemptAt ?? "");
      delays.push(next - at);
      clock.value = next;
      at = next;
      await queue.runDue();
    }
    expect(delays).toEqual([5_000, 10_000, 20_000]);
  });

  test("error −1 is temporary: queued and resent", async () => {
    const { queue, clock } = setup({ transport: scripted([rejected(-1)]) });
    const first = await queue.submit(input());
    expect(first).toMatchObject({ status: "queued", code: -1, attempts: 1 });
    clock.advance(5_000);
    await queue.runDue();
    expect((await queue.get(first.id as string))?.status).toBe("accepted");
  });

  test("error 8 is tried three times, then left to a person (OQ5)", async () => {
    const { queue, transport, clock, events } = setup({
      transport: scripted([rejected(8), rejected(8), rejected(8)]),
    });
    const { id } = await queue.submit(input());
    for (let i = 0; i < 4; i++) {
      clock.advance(300_000);
      await queue.runDue();
    }
    expect(transport.requests).toHaveLength(3);
    expect(await queue.get(id as string)).toMatchObject({ status: "rejected", code: 8 });
    expect(events.filter((e) => e.type === "needs_attention")).toMatchObject([
      { id, status: "rejected", code: 8 },
    ]);
  });

  test("a permanent error is not resent", async () => {
    const { queue, transport, clock } = setup({ transport: scripted([rejected(4)]) });
    const result = await queue.submit(input());
    expect(result).toMatchObject({ status: "rejected", code: 4, message: "chyba 4" });
    clock.advance(3_600_000);
    await queue.runDue();
    expect(transport.requests).toHaveLength(1);
  });

  test("an untrusted answer is never resent automatically", async () => {
    const { queue, transport, clock, events } = setup({
      transport: scripted([uncertain("signature")]),
    });
    const result = await queue.submit(input());
    expect(result).toMatchObject({ status: "uncertain", reason: "signature" });
    expect(result.nextAttemptAt).toBeUndefined();
    clock.advance(3_600_000);
    await queue.runDue();
    expect(transport.requests).toHaveLength(1);
    expect(events.some((e) => e.type === "needs_attention")).toBe(true);
  });

  test("retryUncertain=false waits for a manual retry", async () => {
    const { queue, transport, clock } = setup({
      transport: scripted([uncertain("timeout")]),
      retryUncertain: false,
    });
    const result = await queue.submit(input());
    expect(result.nextAttemptAt).toBeUndefined();
    clock.advance(3_600_000);
    await queue.runDue();
    expect(transport.requests).toHaveLength(1);
    expect(await queue.retry(result.id as string)).toMatchObject({
      status: "accepted",
      attempts: 2,
    });
    expect(transport.requests[1]?.header.prvni_zaslani).toBe(false);
  });

  test("an envelope over 12 kB is invalid and stays so", async () => {
    const { queue } = setup({ transport: scripted([notSent("too_large")]) });
    const result = await queue.submit(input());
    expect(result).toMatchObject({ status: "invalid", reason: "too_large" });
    expect(queue.retry(result.id as string)).rejects.toMatchObject({ code: "not_retryable" });
  });

  test("a sale without POK after 48 h is overdue", async () => {
    const { queue, events } = setup({ transport: scripted([notSent()]) });
    const old = input("OLD-1", { dat_trzby: "2026-10-23T17:00:00+01:00", prvni_zaslani: false });
    const result = await queue.submit(old);
    expect(result).toMatchObject({ status: "queued", overdue: true });
    expect(result.deadlineAt).toBe("2026-10-25T16:00:00.000Z");
    expect(events.filter((e) => e.type === "overdue")).toMatchObject([{ id: result.id }]);
    const page = await queue.list({ overdue: true });
    expect(page.items.map((r) => r.id)).toEqual([result.id]);
  });
});

describe("manual retry", () => {
  test("resends a rejected sale; final ones are refused", async () => {
    const { queue, transport } = setup({ transport: scripted([rejected(4)]) });
    const { id } = await queue.submit(input());
    const result = await queue.retry(id as string);
    expect(result).toMatchObject({ status: "accepted", attempts: 2 });
    expect(transport.requests[1]?.header.prvni_zaslani).toBe(false);
    expect(queue.retry(id as string)).rejects.toMatchObject({ code: "not_retryable" });
    expect(queue.retry("nope")).rejects.toBeInstanceOf(QueueError);
    expect(queue.retry("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  test("a sale being sent is not sent twice", async () => {
    const hold = blocking();
    const { queue, transport } = setup({ transport: scripted([hold.step]) });
    const pending = queue.submit(input());
    await Bun.sleep(0);
    const [record] = (await queue.list()).items;
    const again = queue.retry(record?.id as string);
    hold.release();
    expect(await again).toEqual(await pending);
    expect(transport.requests).toHaveLength(1);
  });
});

describe("idempotence and duplicates", () => {
  test("same idempotency key and sale → the stored result, nothing sent", async () => {
    const { queue, transport } = setup();
    const first = await queue.submit(input(), { idempotencyKey: "k-1" });
    const again = await queue.submit(input(), { idempotencyKey: "k-1" });
    expect(again.id).toBe(first.id);
    expect(again.status).toBe("accepted");
    expect(codes(again).at(-1)).toBe(QueueWarningCode.SALE_REPLAYED);
    expect(again.warnings.at(-1)?.source).toBe("queue");
    expect(transport.requests).toHaveLength(1);
  });

  test("same key for another sale → idempotency_conflict", async () => {
    const { queue, transport } = setup();
    await queue.submit(input("U-1"), { idempotencyKey: "k-1" });
    const other = await queue.submit(input("U-2"), { idempotencyKey: "k-1" });
    expect(other).toMatchObject({ status: "invalid", issues: [{ code: "idempotency_conflict" }] });
    expect(other.id).toBeUndefined();
    expect(transport.requests).toHaveLength(1);
  });

  test("concurrent calls with one key → one record, one send, the same answer", async () => {
    const hold = blocking();
    const { queue, transport } = setup({ transport: scripted([hold.step]) });
    const calls = [1, 2, 3].map(() => queue.submit(input(), { idempotencyKey: "k-1" }));
    await Bun.sleep(0);
    hold.release();
    const results = await Promise.all(calls);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.map((r) => r.status)).toEqual(["accepted", "accepted", "accepted"]);
    expect(transport.requests).toHaveLength(1);
  });

  test("the same sale without a key is not sent as a first submission twice", async () => {
    const { queue, transport } = setup();
    const first = await queue.submit(input());
    const { celk_trzba: _, ...rest } = input();
    const again = await queue.submit({ ...rest, totalAmount: 100 }); // same sale, other shape
    expect(again.id).toBe(first.id);
    expect(codes(again)).toContain(QueueWarningCode.SALE_REPLAYED);
    expect(transport.requests).toHaveLength(1);
  });

  test("same uniqueness key with different other data → sale_conflict", async () => {
    const { queue } = setup();
    await queue.submit(input());
    const changed = await queue.submit(input("U-1", { urceno_cerp_zuct: "10.00" }));
    expect(changed).toMatchObject({ status: "invalid", issues: [{ code: "sale_conflict" }] });
  });

  test("verification messages are never deduplicated", async () => {
    const { queue, transport } = setup({ transport: scripted([verificationOk, verificationOk]) });
    await queue.submit(input(), { verify: true });
    await queue.submit(input(), { verify: true });
    expect(transport.requests).toHaveLength(2);
  });
});

describe("endpoint gate (ADR-003)", () => {
  test("during an outage resends wait for one probe; first attempts are never held back", async () => {
    const transport = scripted([notSent(), notSent(), notSent(), notSent(), notSent()]);
    const { queue, clock } = setup({ transport });
    const ids = [];
    for (const porad of ["A", "B", "C"])
      ids.push((await queue.submit(input(porad), { mode: "async" })).id);
    await queue.runDue();
    expect(transport.requests).toHaveLength(3);

    clock.advance(1_000);
    ids.push((await queue.submit(input("D"), { mode: "async" })).id);
    await queue.runDue();
    expect(transport.requests).toHaveLength(4); // D's first attempt went out

    clock.advance(5_000); // A, B, C and D are due; one probe goes out and fails
    await queue.runDue();
    expect(transport.requests).toHaveLength(5);
    expect(transport.requests[4]?.header.prvni_zaslani).toBe(false);

    clock.advance(5_000); // the probe backs off to 10 s: nothing yet
    await queue.runDue();
    expect(transport.requests).toHaveLength(5);

    clock.advance(5_000); // EET is back: the probe succeeds and the rest follow at once
    await queue.runDue();
    expect(transport.requests).toHaveLength(9);
    for (const id of ids) expect((await queue.get(id as string))?.status).toBe("accepted");
  });
});

describe("crash recovery in one process", () => {
  test("an attempt whose lease ran out is interrupted, then resent with prvni_zaslani=false", async () => {
    const hold = blocking();
    const { queue, transport, clock, events } = setup({ transport: scripted([hold.step]) });
    const pending = queue.submit(input());
    await Bun.sleep(0);
    const [record] = (await queue.list()).items;
    const id = record?.id as string;

    clock.advance(120_001); // the lease runs out — as if the process had died
    await queue.runDue();
    expect(await queue.get(id)).toMatchObject({ status: "uncertain", reason: "interrupted" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attempt", id, outcome: "interrupted" }),
    );

    clock.advance(5_000);
    await queue.runDue();
    expect(await queue.get(id)).toMatchObject({ status: "accepted", attempts: 2 });
    expect(transport.requests.map((r) => r.header.prvni_zaslani)).toEqual([true, false]);

    // The hung attempt finally answers: its result is not stored over the newer one.
    hold.release();
    expect(await pending).toMatchObject({ status: "accepted", attempts: 2 });
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect((await queue.attempts(id)).map((a) => a.outcome)).toEqual(["interrupted", "accepted"]);
  });

  test("a POK that cannot be stored still reaches the caller", async () => {
    const memory = createMemoryStore();
    const store: QueueStore = {
      ...memory,
      finishAttempt: async () => {
        throw new Error("disk full");
      },
    };
    const { queue, events } = setup({ store });
    const result = await queue.submit(input());
    expect(result.status).toBe("accepted");
    expect(result.pok).toBeString();
    expect(events).toContainEqual({
      type: "error",
      id: result.id,
      message: "Výsledek se neuložil: disk full",
    });
  });
});

describe("registers and input", () => {
  const two = () => {
    const transport = scripted();
    const queue = createEetQueue({
      store: createMemoryStore(),
      registers: {
        main: { transport, context: { register: DEFAULTS } },
        second: { transport, context: { register: { ...DEFAULTS, id_pokl: "P2" } } },
      },
      now: () => T0,
    });
    return { queue, transport };
  };

  test("invalid input is reported and nothing is stored", async () => {
    const { queue, transport } = setup();
    const result = await queue.submit(input("Účtenka"));
    expect(result).toMatchObject({
      status: "invalid",
      attempts: 0,
      issues: [{ code: "non_ascii" }],
    });
    expect((await queue.list()).items).toEqual([]);
    expect(transport.requests).toHaveLength(0);
  });

  test("the register comes from the call or the input, with its defaults", async () => {
    const { queue, transport } = two();
    expect(await queue.submit(input())).toMatchObject({
      status: "invalid",
      issues: [{ code: "unknown_register" }],
    });
    expect((await queue.submit(input("A"), { register: "second" })).register).toBe("second");
    expect((await queue.submit(input("B", { registerId: "second" }))).register).toBe("second");
    expect(transport.requests.map((r) => r.data.id_pokl)).toEqual(["P2", "P2"]);
    expect(await queue.submit(input(), { register: "third" })).toMatchObject({
      issues: [{ code: "unknown_register" }],
    });
    expect(
      await queue.submit(input("C", { register: "second" }), { register: "main" }),
    ).toMatchObject({ issues: [{ code: "conflicting_fields" }] });
  });

  test("invalid options are refused at creation", () => {
    const make = (extra: object) => () =>
      createEetQueue({ store: createMemoryStore(), registers: {}, ...extra });
    expect(make({ concurrency: 0 })).toThrow(RangeError);
    expect(make({ leaseMs: 1_000 })).toThrow(RangeError);
    expect(make({ retry: { maxDelayMs: 1, initialDelayMs: 5 } })).toThrow(RangeError);
    expect(make({ retry: { jitter: 1 } })).toThrow(RangeError);
  });
});

describe("batches", () => {
  const csv = [
    "porad_cis;dat_trzby;celk_trzba",
    "B-1;2026-10-25T18:00:00+01:00;10,00",
    "B-2;nonsense;10.00",
    "B-1;2026-10-25T18:00:00+01:00;10.00",
  ].join("\n");

  test("one result per row, duplicates within the batch are replays", async () => {
    const { queue, transport } = setup();
    const batch = await queue.submitBatch(csv, "csv", { idempotencyKey: "file-1" });
    expect(batch.issues).toEqual([]);
    expect(batch.rows.map((r) => [r.row, r.result.status])).toEqual([
      [2, "accepted"],
      [3, "invalid"],
      [4, "accepted"],
    ]);
    expect(batch.rows[2]?.result.id).toBe(batch.rows[0]?.result.id);
    expect(transport.requests).toHaveLength(1);

    const again = await queue.submitBatch(csv, "csv", { idempotencyKey: "file-1" });
    expect(again.rows.map((r) => codes(r.result).includes(1071))).toEqual([true, false, true]);
    expect(transport.requests).toHaveLength(1);
  });

  test("an unreadable batch is reported as a whole", async () => {
    const { queue } = setup();
    const batch = await queue.submitBatch("<!DOCTYPE x><Data/>", "xml");
    expect(batch).toMatchObject({ rows: [], issues: [{ code: "unsupported_format" }] });
  });
});

describe("list", () => {
  test("filters by status and pages newest first", async () => {
    const { queue, clock } = setup({ transport: scripted([rejected(4)]) });
    const a = await queue.submit(input("A"));
    clock.advance(1);
    const b = await queue.submit(input("B"));
    clock.advance(1);
    const c = await queue.submit(input("C"));
    expect((await queue.list({ status: "rejected" })).items.map((r) => r.id)).toEqual([a.id]);
    const page = await queue.list({ limit: 2 });
    expect(page.items.map((r) => r.id)).toEqual([c.id, b.id]);
    const rest = await queue.list({ limit: 2, cursor: page.nextCursor });
    expect(rest.items.map((r) => r.id)).toEqual([a.id]);
    expect(queue.list({ from: "yesterday" })).rejects.toThrow(RangeError);
  });

  test("events carry ids and codes only", async () => {
    const { queue, events } = setup({ transport: scripted([rejected(4)]) });
    await queue.submit(input());
    expect(events.map((e) => e.type)).toEqual(["attempt", "needs_attention"]);
    for (const event of events) {
      expect(
        Object.keys(event).every((k) =>
          [
            "type",
            "id",
            "register",
            "attempt",
            "outcome",
            "reason",
            "code",
            "status",
            "nextAttemptAt",
            "message",
          ].includes(k),
        ),
      ).toBe(true);
    }
  });

  test("the endpoint of every attempt is recorded", async () => {
    const { queue } = setup();
    const { id } = await queue.submit(input());
    expect(await queue.attempts(id as string)).toMatchObject([
      { endpoint: ENDPOINT, environment: "playground", overeni: false },
    ]);
  });
});

describe("batches across registers and validation", () => {
  const twoRegisters = () => {
    const transport = scripted();
    const queue = createEetQueue({
      store: createMemoryStore(),
      registers: {
        main: { transport, context: { register: DEFAULTS } },
        second: { transport, context: { register: { ...DEFAULTS, id_pokl: "P2" } } },
      },
      now: () => T0,
    });
    return { queue, transport };
  };
  const ndjson = [
    JSON.stringify(input("R-1", { register: "second" })),
    JSON.stringify(input("R-2")),
    "{broken",
  ].join("\n");

  test("each row picks its register; the option is the default", async () => {
    const { queue, transport } = twoRegisters();
    const batch = await queue.submitBatch(ndjson, "ndjson", { register: "main" });
    expect(batch.rows.map((r) => [r.row, r.result.status, r.result.register])).toEqual([
      [1, "accepted", "second"],
      [2, "accepted", "main"],
      [3, "invalid", undefined],
    ]);
    expect(transport.requests.map((r) => r.data.id_pokl)).toEqual(["P2", "P1"]);
  });

  test("validateBatch normalizes like submitBatch and stores nothing", async () => {
    const { queue, transport } = twoRegisters();
    const result = queue.validateBatch(ndjson, "ndjson", { register: "main", verify: true });
    expect(result.rows.map((r) => [r.row, r.result.valid, r.result.register])).toEqual([
      [1, true, "second"],
      [2, true, "main"],
      [3, false, undefined],
    ]);
    expect(result.rows[0]?.result).toMatchObject({
      data: { id_pokl: "P2", porad_cis: "R-1" },
      overeni: true,
      prvni_zaslani: true,
    });
    expect(result.rows[2]?.result.issues).toMatchObject([{ code: "parse_error" }]);
    expect((await queue.list()).items).toEqual([]);
    expect(transport.requests).toHaveLength(0);
  });
});
