import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CertificateInfo } from "@eet-gateway/core";
import { ConfigError, type ConfigIssue, parseConfig } from "../src/config.ts";
import {
  activeCertificate,
  expiryNotices,
  loadRegisters,
  registerStatus,
} from "../src/registers.ts";
import { PG_P12, PG_PASSWORD_FILE, pgConfig, tempDir } from "./helpers.ts";

// CZ00000019 is valid 2026-05-13T09:40:23Z … 2027-05-14T09:40:23Z (SPEC_NOTES §12).
const at = (iso: string) => () => new Date(iso);
const config = (raw = pgConfig()) => parseConfig(raw, { baseDir: "/" });

async function problems(promise: Promise<unknown>): Promise<ConfigIssue[]> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConfigError) return [...error.issues];
    throw error;
  }
  return [];
}

describe("loadRegisters", () => {
  test("loads the certificate; eic_popl defaults to its EIČ", async () => {
    const [register] = await loadRegisters(config().registers, { now: at("2026-10-25T12:00:00Z") });
    expect(register).toMatchObject({
      id: "kasa-1",
      environment: "playground",
      context: {
        register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "KASA-1" },
        certificateEic: "CZ00000019",
        timeZone: "Europe/Prague",
      },
    });
    expect(register?.transport.endpoint).toBe(register?.endpoint as string);
  });

  test("the password may come from the environment", async () => {
    const raw = pgConfig();
    raw.registers["kasa-1"].certificates = [{ p12: PG_P12 } as never];
    const password = (await Bun.file(PG_PASSWORD_FILE).text()).trim();
    const registers = await loadRegisters(config(raw).registers, {
      env: { EET_REGISTER_KASA_1_P12_PASSWORD: password },
    });
    expect(registers).toHaveLength(1);
    expect(await problems(loadRegisters(config(raw).registers))).toEqual([
      {
        path: "registers.kasa-1.certificates.0",
        message: "chybí heslo: passwordFile nebo EET_REGISTER_KASA_1_P12_PASSWORD",
      },
    ]);
  });

  test("a wrong password or a missing file is reported without the password", async () => {
    const dir = tempDir();
    const wrong = join(dir, "wrong");
    writeFileSync(wrong, "WrongPass1\n");
    const raw = pgConfig();
    raw.registers["kasa-1"].certificates = [
      { p12: PG_P12, passwordFile: wrong },
      { p12: join(dir, "missing.p12"), passwordFile: wrong },
    ];
    const found = await problems(loadRegisters(config(raw).registers));
    expect(found.map((i) => i.path)).toEqual([
      "registers.kasa-1.certificates.0",
      "registers.kasa-1.certificates.1",
    ]);
    expect(found[1]?.message).toStartWith("soubor nenalezen:");
    expect(JSON.stringify(found)).not.toContain("WrongPass1");
  });

  test("a playground certificate cannot serve a production register", async () => {
    const raw = pgConfig({ productionEndpoint: "https://eet.example/v4" });
    (raw.registers["kasa-1"] as { environment: string }).environment = "production";
    expect(await problems(loadRegisters(config(raw).registers))).toEqual([
      {
        path: "registers.kasa-1.certificates.0",
        message: "certifikát je pro playground, pokladna pro production",
      },
    ]);
  });

  test("with no valid certificate nothing is signed and the sale stays queued", async () => {
    const [register] = await loadRegisters(config().registers, { now: at("2027-06-01T00:00:00Z") });
    const outcome = await register?.transport.send({
      data: {
        eic_popl: "CZ00000019",
        id_jednotky: "11",
        id_pokl: "K",
        porad_cis: "1",
        dat_trzby: "2027-06-01T02:00:00+02:00",
        celk_trzba: "1.00",
      },
      header: {
        uuid_zpravy: crypto.randomUUID(),
        dat_odesl: "2027-06-01T02:00:00+02:00",
        prvni_zaslani: true,
      },
    });
    expect(outcome).toMatchObject({ kind: "not_sent", reason: "signer" });
  });
});

describe("certificate status and expiry", () => {
  test("active, expiring within 21 days, expired", async () => {
    const [register] = await loadRegisters(config().registers);
    if (register === undefined) throw new Error("no register");
    const status = (iso: string) => registerStatus(register, new Date(iso)).certificates[0];
    expect(status("2026-10-25T12:00:00Z")).toMatchObject({
      eic: "CZ00000019",
      notAfter: "2027-05-14T09:40:23.000Z",
      daysLeft: 200,
      active: true,
      expiresSoon: false,
      expired: false,
    });
    expect(status("2027-04-24T09:40:24Z")).toMatchObject({ daysLeft: 19, expiresSoon: true });
    expect(status("2027-05-15T00:00:00Z")).toMatchObject({
      active: false,
      expiresSoon: false,
      expired: true,
    });

    expect(expiryNotices([register], new Date("2026-10-25T12:00:00Z"))).toEqual([]);
    expect(expiryNotices([register], new Date("2027-05-01T00:00:00Z"))).toMatchObject([
      { level: "warn", register: "kasa-1" },
    ]);
    expect(expiryNotices([register], new Date("2027-06-01T00:00:00Z")).map((n) => n.level)).toEqual(
      ["error", "error"],
    );
  });

  test("of overlapping certificates the most recently issued valid one signs", () => {
    const info = (from: string, to: string) => ({
      info: { notBefore: new Date(from), notAfter: new Date(to) } as CertificateInfo,
    });
    const certificates = [
      info("2026-01-01", "2027-01-01"),
      info("2026-12-01", "2027-12-01"),
      info("2028-01-01", "2029-01-01"),
    ];
    expect(activeCertificate(certificates, new Date("2026-06-01"))).toBe(0);
    expect(activeCertificate(certificates, new Date("2026-12-15"))).toBe(1);
    expect(activeCertificate(certificates, new Date("2027-12-15"))).toBeUndefined();
  });
});
