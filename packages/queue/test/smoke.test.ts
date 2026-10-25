import { describe, expect, test } from "bun:test";
import { VERSION as CORE_VERSION } from "@eet-gateway/core";
import { VERSION } from "../src/index.ts";

const SEMVER = /^\d+\.\d+\.\d+$/;

describe("@eet-gateway/queue", () => {
  test("exports a semver version", () => {
    expect(VERSION).toMatch(SEMVER);
  });

  test("resolves its workspace dependencies", () => {
    expect(CORE_VERSION).toMatch(SEMVER);
  });
});
