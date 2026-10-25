import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore, createSqliteStore } from "../src/index.ts";
import { makeRecord, storeContract } from "./store-contract.ts";

const dir = mkdtempSync(join(tmpdir(), "eet-queue-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let files = 0;

storeContract("memory", createMemoryStore);
storeContract("bun:sqlite in memory", () => createSqliteStore(new Database(":memory:")));
storeContract("bun:sqlite file", () => {
  files += 1;
  return createSqliteStore(new Database(join(dir, `contract-${files}.db`)));
});

test("SQLite: records survive reopening, the schema is created once", async () => {
  const path = join(dir, "reopen.db");
  const record = makeRecord({ idempotencyKey: "persist" });
  const db = new Database(path);
  await createSqliteStore(db).insert(record);
  db.close();

  const reopened = new Database(path);
  const store = createSqliteStore(reopened);
  expect(await store.get(record.id)).toEqual(record);
  expect(reopened.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  reopened.close();
});

test("SQLite: refuses a database written by a newer schema", () => {
  const db = new Database(":memory:");
  createSqliteStore(db);
  db.run("UPDATE eet_queue_meta SET value = '99' WHERE key = 'schema_version'");
  expect(() => createSqliteStore(db)).toThrow(/newer than this library/);
});

test("SQLite: shares a database with the application's own tables", async () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE app_orders (id INTEGER PRIMARY KEY)");
  db.run("PRAGMA user_version = 7");
  const store = createSqliteStore(db);
  await store.insert(makeRecord());
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 7 });
});
