import { expect, test } from "bun:test";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { createEetQueue, createMemoryStore } from "@eet-gateway/queue";
import { createApp } from "../src/app.ts";
import { VERSION } from "../src/index.ts";
import { buildOpenApi, componentSchema, ROUTES } from "../src/openapi.ts";
import { expectSchema } from "./app-helpers.ts";
import { REPO_ROOT } from "./helpers.ts";

const document = buildOpenApi(VERSION);

test("the document is valid OpenAPI 3.1", async () => {
  const api = await SwaggerParser.validate(structuredClone(document) as never);
  expect((api as { openapi: string }).openapi).toStartWith("3.1");
});

test("every Hono route is documented and every documented route exists", () => {
  const app = createApp({
    queue: createEetQueue({ store: createMemoryStore(), registers: {} }),
    apiKeys: [],
    registers: () => [],
  });
  const served = new Set(
    app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
  );
  const documented = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  expect([...served].sort()).toEqual([...documented].sort());
});

test("response schemas reject undocumented fields", () => {
  expect(componentSchema("SaleResult")["additionalProperties"]).toBe(false);
  expect(() =>
    expectSchema("SaleResult", { status: "queued", warnings: [], attempts: 0, surprise: 1 }),
  ).toThrow(/additional properties/);
});

test("docs/openapi.json is up to date (bun run gen:openapi)", async () => {
  const committed = await Bun.file(join(REPO_ROOT, "docs/openapi.json")).json();
  expect(committed).toEqual(document);
});
