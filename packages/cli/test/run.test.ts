import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigError } from "@eet-gateway/server";
import { rejected, scripted, uncertain, verificationOk } from "../../queue/test/helpers.ts";
import { VERSION } from "../src/run.ts";
import { eet, fakeIO, fakeQueue } from "./helpers.ts";

const CSV = [
  "porad_cis;dat_trzby;celk_trzba",
  "C-1;25.10.2026 18:00;100,00",
  "C-2;nonsense;1.00",
].join("\n");
const ONE = "porad_cis,dat_trzby,celk_trzba\nC-1,2026-10-25T18:00:00+01:00,100.00\n";
const files = { "sales.csv": CSV, "one.csv": ONE };

describe("eet send", () => {
  test("sends every row, reports each and exits 3 when one is not accepted", async () => {
    const io = fakeIO({ files });
    const { code, out } = await eet(io, "send", "sales.csv");
    expect(code).toBe(3);
    expect(out).toMatch(/^řádek 2 {2}accepted +POK .+-ff \(playground\) {2}C-1 · 100\.00 · /m);
    expect(out).toMatch(/^řádek 3 {2}invalid +nic se neodeslalo$/m);
    expect(out).toContain("chyba invalid_format (dat_trzby)");
    expect(out).toContain("Celkem 2: 1× accepted, 1× invalid");
    expect(io.opened).toEqual([
      { configPath: undefined, server: false, logger: expect.anything() },
    ]);
    expect(io.closed).toBe(1);
  });

  test("exit 0 when all are accepted; a second run sends nothing again", async () => {
    const { queue, transport } = fakeQueue();
    const io = fakeIO({ files, queue });
    expect((await eet(io, "send", "one.csv")).code).toBe(0);
    const again = await eet(io, "send", "one.csv");
    expect(again.code).toBe(0);
    expect(again.out).toContain("varování 1071 [queue]");
    expect(transport.requests).toHaveLength(1);
  });

  test("stdin needs --format; --json prints the batch result", async () => {
    const io = fakeIO({
      stdin: JSON.stringify([
        { porad_cis: "J-1", dat_trzby: "2026-10-25T18:00:00+01:00", celk_trzba: 5 },
      ]),
    });
    const usage = await eet(io, "send", "-");
    expect(usage.code).toBe(2);
    expect(usage.err).toContain("pro stdin uveď --format");
    const { code, out } = await eet(io, "send", "-", "--format", "json", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(out).rows[0]).toMatchObject({ row: 1, result: { status: "accepted" } });
  });

  test("--verify and --register reach the queue", async () => {
    const transport = scripted([verificationOk]);
    const io = fakeIO({ files, queue: fakeQueue(transport, true).queue });
    const { code, out } = await eet(io, "send", "one.csv", "--verify", "--register", "second");
    expect(code).toBe(0);
    expect(out).toContain("verification_ok");
    expect(transport.requests[0]?.header.overeni).toBe(true);
    expect(transport.requests[0]?.data.id_pokl).toBe("P2");
  });

  test("a rejection shows EET's code and the record id", async () => {
    const io = fakeIO({ files, transport: scripted([rejected(4, "Neplatny podpis SOAP zpravy")]) });
    const { code, out } = await eet(io, "send", "one.csv");
    expect(code).toBe(3);
    expect(out).toContain("rejected          EET 4: Neplatny podpis SOAP zpravy");
    expect(out).toMatch(/^ {4}id [0-9a-f-]{36}$/m);
  });

  test("--verbose lists input conversions and the queue's progress", async () => {
    const io = fakeIO({ files });
    const { out, err } = await eet(io, "send", "one.csv", "--verbose");
    expect(out).toContain("varování 1021 [ingest]");
    expect(io.opened[0]?.logger).toBeDefined();
    expect(err).toBe(""); // the fake gateway does not log; the real one writes to stderr
  });

  test("a bad configuration exits 1 with the report", async () => {
    const io = fakeIO({
      files,
      gatewayError: new ConfigError([
        { path: "registers", message: "nakonfiguruj aspoň jednu pokladnu" },
      ]),
    });
    const { code, err } = await eet(io, "send", "one.csv");
    expect(code).toBe(1);
    expect(err).toBe("Chyba konfigurace:\n  registers: nakonfiguruj aspoň jednu pokladnu\n");
  });

  test("a missing file and an unknown format are reported", async () => {
    const io = fakeIO();
    expect((await eet(io, "send", "nope.csv")).err).toContain("soubor nope.csv neexistuje");
    expect((await eet(io, "send", "sales.txt")).code).toBe(2);
    expect((await eet(io, "send", "a.csv", "b.csv")).code).toBe(2);
    expect((await eet(io, "send", "a.csv", "--frobnicate")).code).toBe(2);
  });
});

describe("eet validate", () => {
  test("with a configuration: register defaults apply, nothing is sent", async () => {
    const { queue, transport } = fakeQueue();
    const io = fakeIO({ files: { ...files, "eet.config.yaml": "x" }, queue });
    const { code, out } = await eet(io, "validate", "sales.csv");
    expect(code).toBe(3);
    expect(out).toContain("řádek 2  platná            pokladna main  C-1 · 100.00");
    expect(out).toContain("řádek 3  neplatná");
    expect(io.opened).toHaveLength(1);
    expect(transport.requests).toHaveLength(0);
    expect((await queue.list()).items).toEqual([]);
  });

  test("without a configuration: plain ingest", async () => {
    const io = fakeIO({ files });
    const { code, out, err } = await eet(io, "validate", "one.csv", "--json");
    expect(code).toBe(3);
    expect(err).toBe("");
    expect(JSON.parse(out).rows[0].result.issues.map((i: { field: string }) => i.field)).toEqual([
      "eic_popl",
      "id_jednotky",
      "id_pokl",
    ]);
    expect(io.opened).toHaveLength(0);
    expect((await eet(io, "validate", "one.csv", "--register", "x")).code).toBe(2);
  });
});

describe("eet queue", () => {
  test("list: empty, filtered table, JSON", async () => {
    const io = fakeIO({ files, transport: scripted([rejected(4)]) });
    expect((await eet(io, "queue", "list")).out).toBe("Fronta je prázdná.\n");
    await eet(io, "send", "sales.csv");
    const table = await eet(io, "queue", "list", "--status", "rejected");
    expect(table.code).toBe(0);
    expect(table.out.split("\n")[0]).toMatch(
      /^id +stav +pokladna +porad_cis +částka +dat_trzby +pokusy +další pokus$/,
    );
    expect(table.out).toMatch(/rejected +main +C-1 +100\.00 +2026-10-25T18:00:00\+01:00 +1/);
    const asJson = JSON.parse((await eet(io, "queue", "list", "--json")).out);
    expect(asJson.items).toHaveLength(1);
    expect(asJson.items[0].data.porad_cis).toBe("C-1");
  });

  test("retry: unknown id → 1; a rejected sale is sent again", async () => {
    const io = fakeIO({ files, transport: scripted([rejected(4)]) });
    expect(await eet(io, "queue", "retry", "nope")).toMatchObject({
      code: 1,
      err: "Záznam nope neexistuje.\n",
    });
    await eet(io, "send", "one.csv");
    const id = JSON.parse((await eet(io, "queue", "list", "--json")).out).items[0].id;
    const retried = await eet(io, "queue", "retry", id);
    expect(retried.code).toBe(0);
    expect(retried.out).toContain("accepted");
    expect((await eet(io, "queue", "retry", id)).code).toBe(1);
  });

  test("flush sends what waits for a resend now; rejected sales stay", async () => {
    const transport = scripted([uncertain("timeout"), rejected(4)]);
    const io = fakeIO({
      files: { ...files, "two.csv": `${ONE}C-3,2026-10-25T18:00:00+01:00,3.00\n` },
      transport,
    });
    await eet(io, "send", "two.csv");
    expect(transport.requests).toHaveLength(2);
    const flushed = await eet(io, "queue", "flush");
    expect(flushed.code).toBe(0);
    expect(flushed.out).toContain("Celkem 1: 1× accepted");
    expect(transport.requests).toHaveLength(3);
    expect(transport.requests[2]?.header.prvni_zaslani).toBe(false);
    const statuses = JSON.parse((await eet(io, "queue", "list", "--json")).out).items.map(
      (r: { status: string }) => r.status,
    );
    expect(statuses.sort()).toEqual(["accepted", "rejected"]);
  });

  test("usage errors", async () => {
    const io = fakeIO();
    expect((await eet(io, "queue")).code).toBe(2);
    expect((await eet(io, "queue", "drop")).code).toBe(2);
    expect((await eet(io, "queue", "list", "--status", "lost")).code).toBe(2);
    expect((await eet(io, "queue", "list", "--limit", "0")).code).toBe(2);
    expect((await eet(io, "queue", "retry")).code).toBe(2);
  });
});

describe("eet cert inspect", () => {
  const CACHE = join(import.meta.dir, "../../../.cache/playground");
  const p12 = join(CACHE, "CA_EET-Playground-CZ00000019.p12");
  const passwordFile = join(CACHE, "password_pokladni_cert_playground.txt");
  const realFiles = async () => ({
    "cert.p12": new Uint8Array(await Bun.file(p12).arrayBuffer()),
    "pw.txt": await Bun.file(passwordFile).text(),
    "wrong.txt": "WrongPass1\n",
  });

  test("password from a file or the environment; human and JSON output", async () => {
    const io = fakeIO({ files: await realFiles() });
    const human = await eet(io, "cert", "inspect", "cert.p12", "--password-file", "pw.txt");
    expect(human.code).toBe(0);
    expect(human.out).toContain("EIČ:          CZ00000019");
    expect(human.out).toContain("Prostředí:    playground (neostré)");
    expect(human.out).toContain("zbývá 200 dní");

    const password = (await Bun.file(passwordFile).text()).trim();
    const envIO = fakeIO({ files: await realFiles(), env: { EET_P12_PASSWORD: password } });
    const asJson = JSON.parse((await eet(envIO, "cert", "inspect", "cert.p12", "--json")).out);
    expect(asJson).toMatchObject({
      eic: "CZ00000019",
      environment: "playground",
      valid: true,
      expired: false,
    });
    expect(asJson.active).toBeUndefined();
  });

  test("asks on a terminal; refuses without a password source", async () => {
    const files = await realFiles();
    const password = (await Bun.file(passwordFile).text()).trim();
    const tty = fakeIO({ files, interactive: true, password });
    expect((await eet(tty, "cert", "inspect", "cert.p12")).code).toBe(0);
    expect(tty.prompts).toBe(1);
    const pipe = fakeIO({ files });
    const refused = await eet(pipe, "cert", "inspect", "cert.p12");
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("--password-file nebo EET_P12_PASSWORD");
  });

  test("a wrong password exits 1 without echoing it; an expired certificate exits 3", async () => {
    const io = fakeIO({ files: await realFiles() });
    const wrong = await eet(io, "cert", "inspect", "cert.p12", "--password-file", "wrong.txt");
    expect(wrong.code).toBe(1);
    expect(wrong.out + wrong.err).not.toContain("WrongPass1");
    const later = fakeIO({ files: await realFiles(), now: new Date("2028-01-01T00:00:00Z") });
    const expired = await eet(later, "cert", "inspect", "cert.p12", "--password-file", "pw.txt");
    expect(expired.code).toBe(3);
    expect(expired.out).toContain("VYPRŠEL");
    expect((await eet(io, "cert", "inspect")).code).toBe(2);
    expect((await eet(io, "cert", "show", "x.p12")).code).toBe(2);
  });
});

describe("eet serve and globals", () => {
  test("serve passes its options on", async () => {
    const io = fakeIO();
    expect((await eet(io, "serve", "--config", "c.yaml", "--port", "0", "--dev")).code).toBe(0);
    expect(io.served).toEqual([{ configPath: "c.yaml", port: 0, dev: true }]);
    expect((await eet(io, "serve", "--port", "x")).code).toBe(2);
  });

  test("help, version, unknown commands", async () => {
    const io = fakeIO();
    const none = await eet(io);
    expect(none.code).toBe(2);
    expect(none.err).toContain("Příkazy:");
    expect((await eet(io, "--help")).code).toBe(0);
    expect((await eet(io, "--version")).out).toBe(`eet ${VERSION}\n`);
    expect((await eet(io, "frobnicate")).code).toBe(2);
    for (const command of ["send", "validate", "serve", "queue", "cert"]) {
      const help = await eet(io, command, "--help");
      expect(help.code).toBe(0);
      expect(help.out).toStartWith("Použití");
    }
  });
});
