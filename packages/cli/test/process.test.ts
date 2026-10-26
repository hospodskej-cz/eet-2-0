/** The real `eet` process with a real configuration and the playground certificate. */
import { afterAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_KEY, PG_P12, PG_PASSWORD_FILE, tempDir } from "../../server/test/helpers.ts";
import { VERSION } from "../src/run.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const dir = tempDir("eet-cli-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = join(dir, "eet.config.yaml");
writeFileSync(
  config,
  [
    "server: { host: 127.0.0.1 }",
    `apiKeys: [${API_KEY}]`,
    "database: ./queue.db",
    "registers:",
    "  kasa-1:",
    "    environment: playground",
    `    certificates: [{ p12: "${PG_P12}", passwordFile: "${PG_PASSWORD_FILE}" }]`,
    "    defaults: { id_jednotky: 11, id_pokl: KASA-1 }",
  ].join("\n"),
);
const sales = join(dir, "sales.csv");
writeFileSync(sales, "porad_cis;dat_trzby;celk_trzba\nP-1;25.10.2026 18:00;12,50\n");

async function eet(...args: string[]) {
  const child = Bun.spawn([process.execPath, MAIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, EET_CONFIG: "" },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

test("--version", async () => {
  expect(await eet("--version")).toMatchObject({ code: 0, out: `eet ${VERSION}\n` });
});

test("validate and queue list against the real configuration", async () => {
  const valid = await eet("validate", sales, "--config", config);
  expect(valid.code).toBe(0);
  expect(valid.out).toContain("platná            pokladna kasa-1  P-1 · 12.50");
  const list = await eet("queue", "list", "--config", config);
  expect(list).toMatchObject({ code: 0, out: "Fronta je prázdná.\n" });
});

test("serve answers and stops on SIGTERM", async () => {
  const child = Bun.spawn([process.execPath, MAIN, "serve", "--config", config, "--port", "0"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let buffer = "";
  let url: URL | undefined;
  while (url === undefined) {
    const { value, done } = await reader.read();
    if (done) throw new Error(await new Response(child.stderr).text());
    buffer += new TextDecoder().decode(value);
    const line = buffer.split("\n").find((l) => l.includes('"listening"'));
    if (line) url = new URL(JSON.parse(line).url);
  }
  expect((await fetch(new URL("/health", url))).status).toBe(200);
  child.kill("SIGTERM");
  expect(await child.exited).toBe(0);
});

test("a configuration problem exits 1", async () => {
  const result = await eet("queue", "list", "--config", join(dir, "missing.yaml"));
  expect(result.code).toBe(1);
  expect(result.err).toContain("konfigurační soubor nenalezen");
});
