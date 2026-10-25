import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/index.ts";

const SEMVER = /^\d+\.\d+\.\d+$/;

describe("@eet-gateway/core", () => {
  test("exports a semver version", () => {
    expect(VERSION).toMatch(SEMVER);
  });
});
