import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { QueueWarningCode } from "../src/index.ts";

const docs = await Bun.file(
  fileURLToPath(new URL("../../../docs/QUEUE.md", import.meta.url)),
).text();
const ISSUE_CODES = ["unknown_register", "idempotency_conflict", "sale_conflict"];
const ERROR_CODES = ["not_found", "not_retryable", "unknown_register", "in_progress"];

// docs/QUEUE.md is the public contract for integrators; keep it complete.
test("every warning code is documented with its name", () => {
  for (const [name, code] of Object.entries(QueueWarningCode)) {
    expect(docs).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|\\s*\`${name}\`\\s*\\|`));
  }
});

test("every issue and error code is documented", () => {
  for (const code of ISSUE_CODES) expect(docs).toMatch(new RegExp(`\\|\\s*\`${code}\`\\s*\\|`));
  for (const code of ERROR_CODES) expect(docs).toContain(`\`${code}\``);
});
