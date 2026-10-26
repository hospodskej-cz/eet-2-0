import { describe, expect, test } from "bun:test";
import { createEetQueue, createMemoryStore } from "@eet-gateway/queue";
import { input, rejected, scripted, uncertain } from "../../queue/test/helpers.ts";
import { createApp, type RequestLog } from "../src/app.ts";
import { VERSION } from "../src/index.ts";
import { expectSchema, REGISTER_STATUS, setupApp } from "./app-helpers.ts";
import { API_KEY } from "./helpers.ts";

const SALE = input("API-1");

describe("authentication", () => {
  test("/v1 needs a valid bearer key; health and docs are public", async () => {
    const { call } = setupApp();
    const missing = await call("/v1/registers", { key: null });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toStartWith("Bearer");
    expectSchema("Error", await missing.json());
    expect((await call("/v1/registers", { key: "wrong-key-0123456789" })).status).toBe(401);
    expect(
      (await call("/v1/registers", { key: null, headers: { authorization: API_KEY } })).status,
    ).toBe(401);

    const ok = await call("/v1/registers");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expectSchema("RegisterList", body);
    expect(body).toEqual({ items: [REGISTER_STATUS] });

    for (const path of ["/health", "/openapi.json", "/docs"])
      expect((await call(path, { key: null })).status).toBe(200);
  });

  test("--dev without keys leaves /v1 open", async () => {
    const { call } = setupApp({ apiKeys: [], dev: true });
    expect((await call("/v1/registers", { key: null })).status).toBe(200);
  });

  test("without keys and without --dev nothing gets in", async () => {
    const { call } = setupApp({ apiKeys: [] });
    expect((await call("/v1/registers", { key: null })).status).toBe(401);
  });
});

describe("POST /v1/sales", () => {
  test("JSON → 200 accepted with Location", async () => {
    const { json } = setupApp();
    const response = await json("/v1/sales", SALE);
    expect(response.status).toBe(200);
    const body = await response.json();
    expectSchema("SaleResult", body);
    expect(body).toMatchObject({ status: "accepted", attempts: 1, register: "main" });
    expect(response.headers.get("location")).toBe(`/v1/sales/${body.id}`);
    expect(response.headers.get("idempotent-replayed")).toBeNull();
  });

  test("XML <Trzba>: header values are taken, generated ones reported", async () => {
    const { call, transport } = setupApp();
    const xml = `<?xml version="1.0"?><eet:Trzba xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka uuid_zpravy="x" overeni="true"/><eet:Data porad_cis="X-1" dat_trzby="2026-10-25T18:00:00+01:00" celk_trzba="1.00"/></eet:Trzba>`;
    const response = await call("/v1/sales", {
      method: "POST",
      body: xml,
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
    const body = await response.json();
    expectSchema("SaleResult", body);
    expect(body.warnings.map((w: { code: number }) => w.code)).toContain(1042);
    expect(transport.requests[0]?.header.overeni).toBe(true);
  });

  test("form fields, urlencoded and multipart", async () => {
    const { call } = setupApp();
    const urlencoded = await call("/v1/sales", {
      method: "POST",
      body: new URLSearchParams(input("F-1")),
    });
    expect((await urlencoded.json()).status).toBe("accepted");
    const form = new FormData();
    for (const [k, v] of Object.entries(input("F-2"))) form.set(k, String(v));
    const multipart = await call("/v1/sales", { method: "POST", body: form });
    expect((await multipart.json()).status).toBe("accepted");
  });

  test("one sale only; unknown content types are refused", async () => {
    const { json, call } = setupApp();
    const array = await json("/v1/sales", [SALE, SALE]);
    expect(array.status).toBe(422);
    expect((await array.json()).error.code).toBe("single_sale_expected");
    const text = await call("/v1/sales", {
      method: "POST",
      body: "x",
      headers: { "content-type": "text/plain" },
    });
    expect(text.status).toBe(415);
    const broken = await call("/v1/sales", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    });
    expect(broken.status).toBe(422);
    const body = await broken.json();
    expectSchema("SaleResult", body);
    expect(body.issues[0].code).toBe("parse_error");
  });

  test("invalid input → 422 with issues", async () => {
    const { json } = setupApp();
    const response = await json("/v1/sales", input("Účtenka"));
    expect(response.status).toBe(422);
    const body = await response.json();
    expectSchema("SaleResult", body);
    expect(body).toMatchObject({ status: "invalid", issues: [{ code: "non_ascii" }] });
  });

  test("Idempotency-Key: replay and conflict", async () => {
    const { json, transport } = setupApp();
    const first = await json("/v1/sales", SALE, { "idempotency-key": "order-42" });
    const again = await json("/v1/sales", SALE, { "idempotency-key": "order-42" });
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect((await again.json()).id).toBe((await first.json()).id);
    const other = await json("/v1/sales", input("API-2"), { "idempotency-key": "order-42" });
    expect(other.status).toBe(409);
    expect(transport.requests).toHaveLength(1);
  });

  test("async → 202 queued; a timeout → 202 uncertain", async () => {
    const { json } = setupApp({ transport: scripted([uncertain("timeout")]) });
    const timedOut = await json("/v1/sales", SALE);
    expect(timedOut.status).toBe(202);
    expect((await timedOut.json()).status).toBe("uncertain");
    const queued = await json("/v1/sales?mode=async", input("API-3"));
    expect(queued.status).toBe(202);
    expect(queued.headers.get("location")).toStartWith("/v1/sales/");
    expect((await queued.json()).status).toBe("queued");
  });

  test("bad options → 400; too large → 413", async () => {
    const { json } = setupApp({ limits: { sale: 100 } });
    expect((await json("/v1/sales?mode=later", SALE)).status).toBe(400);
    expect((await json("/v1/sales?verify=maybe", SALE)).status).toBe(400);
    expect((await json("/v1/sales", SALE, { "idempotency-key": "has space" })).status).toBe(400);
    const big = await json("/v1/sales", { ...SALE, note: "x".repeat(200) });
    expect(big.status).toBe(413);
    expectSchema("Error", await big.json());
  });
});

describe("POST /v1/sales/batch and /v1/validate", () => {
  // "porad_cis;dat_trzby;celk_trzba;poznamka" + one row with "Žluťoučký" in Windows-1250.
  const csv = new Uint8Array([
    ...new TextEncoder().encode(
      "porad_cis;dat_trzby;celk_trzba;poznamka\r\nB-1;25.10.2026 18:00;10,50;",
    ),
    0x8e,
    0x6c,
    0x75,
    0x9d,
    0x6f,
    0x75,
    0xe8,
    0x6b,
    0xfd,
    ...new TextEncoder().encode("\r\nB-2;nonsense;1.00;\r\n"),
  ]);

  test("CSV in Windows-1250, async by default, one result per row", async () => {
    const { call, queue } = setupApp();
    const response = await call("/v1/sales/batch", {
      method: "POST",
      body: csv,
      headers: { "content-type": "text/csv" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expectSchema("BatchResult", body);
    expect(body.warnings.map((w: { code: number }) => w.code)).toEqual([1061]);
    expect(
      body.rows.map((r: { row: number; result: { status: string } }) => [r.row, r.result.status]),
    ).toEqual([
      [2, "queued"],
      [3, "invalid"],
    ]);
    await queue.runDue();
    expect((await queue.get(body.rows[0].result.id))?.status).toBe("accepted");
  });

  test("unreadable → 422, unknown type → 415", async () => {
    const { call } = setupApp();
    const doctype = await call("/v1/sales/batch", {
      method: "POST",
      body: "<!DOCTYPE x><Data/>",
      headers: { "content-type": "application/xml" },
    });
    expect(doctype.status).toBe(422);
    expectSchema("BatchResult", await doctype.json());
    const yaml = await call("/v1/sales/batch", {
      method: "POST",
      body: "a: 1",
      headers: { "content-type": "application/yaml" },
    });
    expect(yaml.status).toBe(415);
  });

  test("validate reports per row and stores nothing", async () => {
    const { call, queue, transport } = setupApp();
    const response = await call("/v1/validate?verify=true", {
      method: "POST",
      body: csv,
      headers: { "content-type": "text/csv" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expectSchema("ValidationBatch", body);
    expect(body.rows[0].result).toMatchObject({
      valid: true,
      register: "main",
      overeni: true,
      data: { porad_cis: "B-1", celk_trzba: "10.50", dat_trzby: "2026-10-25T18:00:00+01:00" },
    });
    expect(body.rows[1].result.valid).toBe(false);
    expect((await queue.list()).items).toEqual([]);
    expect(transport.requests).toHaveLength(0);
  });
});

describe("records", () => {
  test("GET a sale and its attempts; 404 for unknown ids", async () => {
    const { json, call } = setupApp();
    const { id } = await (await json("/v1/sales", SALE)).json();
    const sale = await call(`/v1/sales/${id}`);
    expectSchema("SaleResult", await sale.json());
    const attempts = await call(`/v1/sales/${id}/attempts`);
    const body = await attempts.json();
    expectSchema("AttemptList", body);
    expect(body.items).toMatchObject([
      { n: 1, prvni_zaslani: true, outcome: "accepted", startedAt: "2026-10-25T17:00:00.000Z" },
    ]);
    for (const path of ["/v1/sales/nope", "/v1/sales/nope/attempts"]) {
      const missing = await call(path);
      expect(missing.status).toBe(404);
      expectSchema("Error", await missing.json());
    }
  });

  test("retry: rejected → sent again; final → 409; unknown → 404", async () => {
    const { json, call } = setupApp({ transport: scripted([rejected(4)]) });
    const { id } = await (await json("/v1/sales", SALE)).json();
    const retried = await call(`/v1/sales/${id}/retry`, { method: "POST" });
    expect(retried.status).toBe(200);
    expect((await retried.json()).status).toBe("accepted");
    const final = await call(`/v1/sales/${id}/retry`, { method: "POST" });
    expect(final.status).toBe(409);
    expect((await final.json()).error.code).toBe("not_retryable");
    expect((await call("/v1/sales/nope/retry", { method: "POST" })).status).toBe(404);
  });

  test("GET /v1/queue filters and validates its query", async () => {
    const { json, call } = setupApp({ transport: scripted([rejected(4)]) });
    await json("/v1/sales", input("Q-1"));
    await json("/v1/sales", input("Q-2"));
    const rejectedOnly = await call("/v1/queue?status=rejected,invalid&limit=10");
    const body = await rejectedOnly.json();
    expectSchema("QueuePage", body);
    expect(body.items.map((r: { status: string }) => r.status)).toEqual(["rejected"]);
    const page = await (await call("/v1/queue?limit=1")).json();
    expect(page.nextCursor).toBeString();
    for (const query of ["status=lost", "limit=0", "overdue=perhaps", "from=yesterday", "cursor=x"])
      expect((await call(`/v1/queue?${query}`)).status).toBe(400);
  });
});

describe("system", () => {
  test("health: database and, on request, EET reachability (cached)", async () => {
    let checks = 0;
    let reachable = true;
    const { call, clock } = setupApp({
      checkEndpoint: async () => {
        checks += 1;
        return reachable
          ? { reachable: true, httpStatus: 204, durationMs: 5 }
          : { reachable: false, durationMs: 10_000, error: "timeout" };
      },
    });
    const plain = await call("/health", { key: null });
    const body = await plain.json();
    expectSchema("Health", body);
    expect(body).toEqual({ status: "ok", version: VERSION, database: "ok" });

    const deep = await (await call("/health?eet=true", { key: null })).json();
    expectSchema("Health", deep);
    expect(deep.eet).toMatchObject([{ reachable: true, httpStatus: 204 }]);
    await call("/health?eet=true", { key: null });
    expect(checks).toBe(1);

    reachable = false;
    clock.value += 61_000;
    const down = await call("/health?eet=true", { key: null });
    expect(down.status).toBe(503);
    expect((await down.json()).status).toBe("degraded");
  });

  test("health: a broken database → 503", async () => {
    const { call } = setupApp({
      ping: async () => {
        throw new Error("disk I/O error");
      },
    });
    const response = await call("/health", { key: null });
    expect(response.status).toBe(503);
    expect((await response.json()).database).toBe("error");
  });

  test("unknown paths → 404 JSON; failures → 500 without details; requests are logged by route", async () => {
    const logs: RequestLog[] = [];
    const errors: unknown[] = [];
    const queue = createEetQueue({ store: createMemoryStore(), registers: {} });
    const app = createApp({
      queue: { ...queue, get: async () => Promise.reject(new Error("db exploded")) },
      apiKeys: [API_KEY],
      registers: () => [],
      onRequest: (entry) => logs.push(entry),
      onError: (error) => errors.push(error),
    });
    const auth = { authorization: `Bearer ${API_KEY}` };
    const missing = await app.request("/nowhere", { headers: auth });
    expect(missing.status).toBe(404);
    const crash = await app.request("/v1/sales/abc", { headers: auth });
    expect(crash.status).toBe(500);
    const body = await crash.json();
    expectSchema("Error", body);
    expect(JSON.stringify(body)).not.toContain("exploded");
    expect(errors).toHaveLength(1);
    expect(logs.map((l) => [l.method, l.route, l.status])).toContainEqual([
      "GET",
      "/v1/sales/:id",
      500,
    ]);
  });

  test("/docs pins Scalar with Subresource Integrity", async () => {
    const { call } = setupApp();
    const html = await (await call("/docs", { key: null })).text();
    expect(html).toContain('integrity="sha384-');
    expect(html).toContain("@scalar/api-reference@1.73.1");
  });
});
