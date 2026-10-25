import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { EET_MAX_MESSAGE_BYTES } from "@eet-gateway/core";
import { repoPath } from "../../scripts/lib/sources.ts";
import { extractTrzba, validateAgainstXsd } from "./xmllint.ts";

const SAMPLES_DIR = repoPath("spec/eet-v4.1/samples/");
const VALID_DIR = repoPath("test/fixtures/xsd/valid/");
const INVALID_DIR = repoPath("test/fixtures/xsd/invalid/");

const xmlFiles = (dir: string) => readdirSync(dir).filter((name) => name.endsWith(".xml"));

describe("captured playground requests (spec/eet-v4.1/samples)", () => {
  for (const name of xmlFiles(SAMPLES_DIR)) {
    test(`${name}: <Trzba> conforms to the XSD`, async () => {
      const result = validateAgainstXsd(extractTrzba(await Bun.file(SAMPLES_DIR + name).text()));
      expect(result.output).toContain("validates");
      expect(result.valid).toBe(true);
    });

    test(`${name}: signed envelope fits the size limit`, () => {
      expect(Bun.file(SAMPLES_DIR + name).size).toBeLessThan(EET_MAX_MESSAGE_BYTES);
    });
  }
});

describe("valid fixtures", () => {
  for (const name of xmlFiles(VALID_DIR)) {
    test(name, async () => {
      const result = validateAgainstXsd(await Bun.file(VALID_DIR + name).text());
      expect(result.valid).toBe(true);
    });
  }
});

describe("invalid fixtures (named <attribute>--<defect>.xml)", () => {
  for (const name of xmlFiles(INVALID_DIR)) {
    const attribute = name.split("--")[0];
    test(name, async () => {
      const result = validateAgainstXsd(await Bun.file(INVALID_DIR + name).text());
      expect(result.valid).toBe(false);
      expect(result.output).toContain(`'${attribute}'`);
    });
  }
});
