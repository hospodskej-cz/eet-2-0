/**
 * `eet send --verify` against the EET playground (opt-in: EET_TEST_LIVE=1): one made-up sale in
 * verification mode, through the real process, configuration and certificate.
 */
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEetDateTime } from "@eet-gateway/core";
import { PG_P12, PG_PASSWORD_FILE, tempDir } from "../../../server/test/helpers.ts";

const LIVE = process.env["EET_TEST_LIVE"] === "1";
const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const dir = tempDir("eet-cli-live-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
setDefaultTimeout(30_000);

test.skipIf(!LIVE)("eet send --verify → verification_ok", async () => {
  const config = join(dir, "eet.config.yaml");
  writeFileSync(
    config,
    [
      "database: ./queue.db",
      "registers:",
      "  kasa-1:",
      "    environment: playground",
      `    certificates: [{ p12: "${PG_P12}", passwordFile: "${PG_PASSWORD_FILE}" }]`,
      "    defaults: { id_jednotky: 11, id_pokl: eet2-lib-live }",
    ].join("\n"),
  );
  const now = new Date();
  const sales = join(dir, "sales.csv");
  writeFileSync(
    sales,
    `porad_cis,dat_trzby,celk_trzba\ncli-live-${now.getTime()},${formatEetDateTime(now)},1.00\n`,
  );
  const child = Bun.spawn([process.execPath, MAIN, "send", sales, "--verify", "--config", config], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  expect(out).toContain("verification_ok");
  console.info(out.trim());
});
