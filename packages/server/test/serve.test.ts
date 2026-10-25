/** The real service process: start, answer, stop on SIGTERM; refuse a bad configuration. */
import { afterAll, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_KEY, PG_P12, PG_PASSWORD_FILE, tempDir } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const dir = tempDir("eet-serve-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function config(name: string, { keys = [API_KEY], passwordFile = PG_PASSWORD_FILE } = {}) {
  const path = join(dir, `${name}.yaml`);
  writeFileSync(
    path,
    [
      "server: { host: 127.0.0.1 }",
      `apiKeys: [${keys.join(", ")}]`,
      `database: ./${name}/queue.db`,
      "registers:",
      "  kasa-1:",
      "    environment: playground",
      "    certificates:",
      `      - { p12: "${PG_P12}", passwordFile: "${passwordFile}" }`,
      "    defaults: { id_jednotky: 11, id_pokl: KASA-1 }",
    ].join("\n"),
  );
  return path;
}

function start(args: string[]) {
  const child = Bun.spawn([process.execPath, MAIN, "--port", "0", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, EET_API_KEYS: "" },
  });
  const lines: string[] = [];
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** Resolves with the URL from the "listening" log line. */
  const listening = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done)
        throw new Error(`exited before listening: ${await new Response(child.stderr).text()}`);
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        lines.push(line);
        const entry = JSON.parse(line);
        if (entry.msg === "listening") return new URL(entry.url);
        newline = buffer.indexOf("\n");
      }
    }
  })();
  const rest = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return lines.concat(buffer.split("\n").filter(Boolean));
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { child, listening, rest };
}

test("serves the API and stops cleanly on SIGTERM", async () => {
  const { child, listening, rest } = start(["--config", config("ok")]);
  const url = await listening;
  const get = (path: string, key?: string) =>
    fetch(new URL(path, url), key ? { headers: { authorization: `Bearer ${key}` } } : {});

  expect(await (await get("/health")).json()).toMatchObject({ status: "ok", database: "ok" });
  expect((await get("/v1/registers")).status).toBe(401);
  const registers = await (await get("/v1/registers", API_KEY)).json();
  expect(registers.items[0]).toMatchObject({ id: "kasa-1", certificates: [{ eic: "CZ00000019" }] });
  const validate = await fetch(new URL("/v1/validate", url), {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      porad_cis: "S-1",
      dat_trzby: "2026-10-25T18:00:00+01:00",
      celk_trzba: 1,
    }),
  });
  expect((await validate.json()).rows[0].result.valid).toBe(true);

  child.kill("SIGTERM");
  expect(await child.exited).toBe(0);
  const log = await rest();
  expect(log.map((l) => JSON.parse(l).msg)).toEqual(
    expect.arrayContaining(["listening", "request", "stopping", "stopped"]),
  );
  expect(log.join("\n")).not.toContain(API_KEY);
  expect(existsSync(join(dir, "ok/queue.db"))).toBe(true);
});

test("a wrong password stops the start with a readable report and no secret", async () => {
  const wrong = join(dir, "wrong-password");
  writeFileSync(wrong, "WrongPass1\n");
  const child = Bun.spawn(
    [process.execPath, MAIN, "--config", config("bad", { passwordFile: wrong })],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(await child.exited).toBe(1);
  const stderr = await new Response(child.stderr).text();
  expect(stderr).toStartWith("Chyba konfigurace:\n  registers.kasa-1.certificates.0:");
  expect(stderr).not.toContain("WrongPass1");
});

test("no API keys: refused, except with --dev", async () => {
  const path = config("nokeys", { keys: [] });
  const refused = Bun.spawn([process.execPath, MAIN, "--config", path], {
    stderr: "pipe",
    env: { ...process.env, EET_API_KEYS: "" },
  });
  expect(await refused.exited).toBe(1);
  expect(await new Response(refused.stderr).text()).toContain("apiKeys: bez API klíčů");

  const { child, listening } = start(["--config", path, "--dev"]);
  const url = await listening;
  expect((await fetch(new URL("/v1/registers", url))).status).toBe(200);
  child.kill("SIGTERM");
  expect(await child.exited).toBe(0);
});

test("bad arguments exit with 2", async () => {
  const child = Bun.spawn([process.execPath, MAIN, "--port", "x"], { stderr: "pipe" });
  expect(await child.exited).toBe(2);
});
