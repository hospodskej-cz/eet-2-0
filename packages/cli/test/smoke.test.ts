import { describe, expect, test } from "bun:test";
import { VERSION as CORE_VERSION } from "@eet-gateway/core";
import { VERSION as INGEST_VERSION } from "@eet-gateway/ingest";
import { VERSION as QUEUE_VERSION } from "@eet-gateway/queue";
import { VERSION as SERVER_VERSION } from "@eet-gateway/server";
import { VERSION } from "../src/index.ts";

const SEMVER = /^\d+\.\d+\.\d+$/;

describe("@eet-gateway/cli", () => {
  test("exports a semver version", () => {
    expect(VERSION).toMatch(SEMVER);
  });

  test("resolves its workspace dependencies", () => {
    expect(CORE_VERSION).toMatch(SEMVER);
    expect(INGEST_VERSION).toMatch(SEMVER);
    expect(QUEUE_VERSION).toMatch(SEMVER);
    expect(SERVER_VERSION).toMatch(SEMVER);
  });
});
