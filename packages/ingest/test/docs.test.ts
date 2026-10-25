import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { FIELD_ALIASES, WarningCode } from "../src/index.ts";

const docs = await Bun.file(
  fileURLToPath(new URL("../../../docs/INGEST.md", import.meta.url)),
).text();
const ISSUE_CODES = [
  "required",
  "invalid_type",
  "invalid_format",
  "non_ascii",
  "too_many_decimals",
  "out_of_range",
  "nonexistent_local_time",
  "conflicting_fields",
  "parse_error",
  "unsupported_format",
];

// docs/INGEST.md is the public contract for integrators; keep it complete.
test("every warning code is documented with its name", () => {
  for (const [name, code] of Object.entries(WarningCode)) {
    expect(docs).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|\\s*\`${name}\`\\s*\\|`));
  }
});

test("every issue code is documented", () => {
  for (const code of ISSUE_CODES) expect(docs).toMatch(new RegExp(`\\|\\s*\`${code}\`\\s*\\|`));
});

test("every built-in alias is documented", () => {
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const section = docs.slice(docs.indexOf("## Pole a aliasy"), docs.indexOf("## Normalizace"));
    const row = section.split("\n").find((line) => new RegExp(`^\\|\\s*\`${field}\``).test(line));
    expect(row).toBeDefined();
    for (const alias of aliases) expect(row).toContain(`\`${alias}\``);
  }
});
