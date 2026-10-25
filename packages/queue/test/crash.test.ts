/**
 * A real process crash: a child queues a sale in a SQLite file and dies; a new process opens the
 * same file and finishes the job without a second first submission.
 */
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEetQueue, createSqliteStore } from "../src/index.ts";
import { DEFAULTS, scripted } from "./helpers.ts";

const CHILD = fileURLToPath(new URL("./fixtures/crash-child.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "eet-queue-crash-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function crash(mode: "sync" | "async") {
  const path = join(dir, `${mode}.db`);
  const child = Bun.spawn([process.execPath, CHILD, path, mode], { stderr: "pipe" });
  const code = await child.exited;
  if (code !== (mode === "sync" ? 42 : 43))
    throw new Error(await new Response(child.stderr).text());
  return path;
}

function restart(path: string, start: number) {
  const clock = { value: start };
  const store = createSqliteStore(new Database(path));
  const transport = scripted();
  const queue = createEetQueue({
    store,
    registers: { main: { transport, context: { register: DEFAULTS } } },
    now: () => clock.value,
    random: () => 0.5,
  });
  return { store, transport, queue, clock };
}

test("killed inside send(): the attempt is interrupted and resent with prvni_zaslani=false", async () => {
  const path = await crash("sync");
  const { store, transport, queue, clock } = restart(path, Date.now());
  const [record] = (await store.list({ now: clock.value, limit: 5 })).items;
  const id = record?.id as string;
  expect(record).toMatchObject({ status: "queued", attempts: 1 });
  expect(record?.leaseUntil).toBeNumber();
  const [open] = await store.attempts(id);
  expect(open).toMatchObject({ n: 1, prvni_zaslani: true });
  expect(open?.outcome).toBeUndefined();

  await queue.runDue(); // the lease still runs
  expect(transport.requests).toHaveLength(0);

  clock.value += 120_000;
  await queue.runDue();
  expect(await queue.get(id)).toMatchObject({ status: "uncertain", reason: "interrupted" });

  clock.value += 5_000;
  await queue.runDue();
  expect(await queue.get(id)).toMatchObject({ status: "accepted", attempts: 2 });
  const [resend] = transport.requests;
  expect(resend?.header.prvni_zaslani).toBe(false);
  expect(resend?.header.uuid_zpravy).not.toBe(open?.uuid_zpravy);
  expect(resend?.data).toEqual(record?.data as NonNullable<typeof record>["data"]);
  expect((await store.attempts(id)).map((a) => [a.outcome, a.prvni_zaslani])).toEqual([
    ["interrupted", true],
    ["accepted", false],
  ]);
});

test("killed before the first attempt: the restart sends it as the first submission", async () => {
  const path = await crash("async");
  const { store, transport, queue } = restart(path, Date.now());
  await queue.runDue();
  const [record] = (await store.list({ now: Date.now(), limit: 5 })).items;
  expect(record).toMatchObject({ status: "accepted", attempts: 1 });
  expect(transport.requests.map((r) => r.header.prvni_zaslani)).toEqual([true]);
});
