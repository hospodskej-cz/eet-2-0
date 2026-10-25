import { describe, expect, test } from "bun:test";
import { EET_PLAYGROUND_ENDPOINT } from "@eet-gateway/core";
import { ConfigError, type ConfigIssue, parseConfig, registerEnvId } from "../src/config.ts";
import { API_KEY } from "./helpers.ts";

const BASE = {
  apiKeys: [API_KEY],
  registers: {
    "kasa-1": {
      environment: "playground",
      certificates: [{ p12: "certs/kasa-1.p12", passwordFile: "secrets/kasa-1" }],
      defaults: { id_jednotky: 11, id_pokl: "KASA-1" },
    },
  },
};

function issues(raw: unknown, env: Record<string, string> = {}, dev = false): ConfigIssue[] {
  try {
    parseConfig(raw, { baseDir: "/etc/eet", env, dev });
  } catch (error) {
    if (error instanceof ConfigError) return [...error.issues];
    throw error;
  }
  return [];
}

describe("parseConfig", () => {
  test("defaults, resolved paths and per-register settings", () => {
    const config = parseConfig(BASE, { baseDir: "/etc/eet" });
    expect(config).toMatchObject({
      server: { host: "0.0.0.0", port: 8080 },
      apiKeys: [API_KEY],
      database: "/etc/eet/eet-queue.db",
      timeZone: "Europe/Prague",
      dev: false,
    });
    expect(config.registers).toEqual([
      {
        id: "kasa-1",
        environment: "playground",
        endpoint: EET_PLAYGROUND_ENDPOINT,
        certificates: [
          {
            p12: "/etc/eet/certs/kasa-1.p12",
            passwordFile: "/etc/eet/secrets/kasa-1",
            passwordEnv: "EET_REGISTER_KASA_1_P12_PASSWORD",
          },
        ],
        defaults: { id_jednotky: "11", id_pokl: "KASA-1" },
        timeoutMs: undefined,
        timeZone: "Europe/Prague",
        fieldMap: undefined,
        debug: false,
      },
    ]);
  });

  test("EET_* variables override the file", () => {
    const config = parseConfig(
      {
        ...BASE,
        registers: {
          ...BASE.registers,
          shop: { environment: "production", certificates: [{ p12: "/c/shop.p12" }] },
        },
      },
      {
        baseDir: "/etc/eet",
        env: {
          EET_API_KEYS: " key-aaaaaaaaaaaaaaaa , key-bbbbbbbbbbbbbbbb ,",
          EET_DB_PATH: "/data/q.db",
          EET_DEFAULT_TZ: "Europe/Bratislava",
          EET_ENDPOINT_PRODUCTION: "https://eet.example/v4",
          EET_PORT: "9090",
          EET_REGISTER_KASA_1_P12_PATH: "/run/secrets/new.p12",
          UNRELATED: "x",
        },
      },
    );
    expect(config.apiKeys).toEqual(["key-aaaaaaaaaaaaaaaa", "key-bbbbbbbbbbbbbbbb"]);
    expect(config.database).toBe("/data/q.db");
    expect(config.server.port).toBe(9090);
    expect(config.registers.map((r) => [r.id, r.endpoint, r.timeZone])).toEqual([
      ["kasa-1", EET_PLAYGROUND_ENDPOINT, "Europe/Bratislava"],
      ["shop", "https://eet.example/v4", "Europe/Bratislava"],
    ]);
    expect(config.registers[0]?.certificates[0]).toMatchObject({
      p12: "/run/secrets/new.p12",
      passwordFile: "/etc/eet/secrets/kasa-1",
    });
  });

  test("a register may get its only certificate from the environment", () => {
    const raw = { apiKeys: [API_KEY], registers: { a: { environment: "playground" } } };
    expect(issues(raw)).toEqual([
      { path: "registers.a.certificates", message: "chybí (nebo EET_REGISTER_A_P12_PATH)" },
    ]);
    const config = parseConfig(raw, { baseDir: "/x", env: { EET_REGISTER_A_P12_PATH: "a.p12" } });
    expect(config.registers[0]?.certificates).toEqual([
      { p12: "/x/a.p12", passwordFile: undefined, passwordEnv: "EET_REGISTER_A_P12_PASSWORD" },
    ]);
  });

  test("a password in the file is refused and never repeated", () => {
    const raw = structuredClone(BASE) as Record<string, unknown>;
    (raw as typeof BASE).registers["kasa-1"].certificates = [
      { p12: "a.p12", password: "Sup3rSecret" } as never,
    ];
    const found = issues(raw);
    expect(found).toEqual([
      {
        path: "registers.kasa-1.certificates.0.password",
        message:
          "heslo do konfiguračního souboru nepatří; použij passwordFile nebo EET_REGISTER_KASA_1_P12_PASSWORD",
      },
    ]);
    expect(JSON.stringify(found)).not.toContain("Sup3rSecret");
  });

  test("every problem is reported at once, with its path", () => {
    const found = issues({
      apiKeys: ["short"],
      timeZone: "Mars/Olympus",
      surprise: true,
      registers: {
        shop: {
          environment: "production",
          certificates: [{ p12: "s.p12" }],
          fieldMap: { Cena: "price" },
        },
      },
    });
    expect(found.map((i) => i.path)).toEqual(["apiKeys.0", "(soubor)"]);
    const later = issues({
      apiKeys: [API_KEY],
      timeZone: "Mars/Olympus",
      registers: {
        shop: {
          environment: "production",
          certificates: [{ p12: "s.p12" }],
          fieldMap: { Cena: "price" },
        },
      },
    });
    expect(later.map((i) => i.path)).toEqual([
      "timeZone",
      "registers.shop.endpoint",
      "registers.shop.timeZone",
      "registers.shop.fieldMap.Cena",
    ]);
    const error = new ConfigError(later);
    expect(error.message).toStartWith("Chyba konfigurace:\n  timeZone: neznámá časová zóna");
  });

  test("API keys are required, except with --dev, which refuses production registers", () => {
    const noKeys = { ...BASE, apiKeys: [] };
    expect(issues(noKeys).map((i) => i.path)).toEqual(["apiKeys"]);
    expect(issues(noKeys, {}, true)).toEqual([]);
    const production = {
      ...noKeys,
      productionEndpoint: "https://eet.example/v4",
      registers: { p: { environment: "production", certificates: [{ p12: "p.p12" }] } },
    };
    expect(issues(production, {}, true).map((i) => i.message)).toEqual([
      "--dev nesmí obsluhovat produkční pokladnu",
    ]);
  });

  test("environment variables must match a configured register unambiguously", () => {
    expect(issues(BASE, { EET_REGISTER_OTHER_P12_PATH: "x.p12" })).toEqual([
      { path: "EET_REGISTER_OTHER_P12_PATH", message: "pokladna s tímto id v konfiguraci není" },
    ]);
    const clash = {
      ...BASE,
      registers: { ...BASE.registers, kasa_1: BASE.registers["kasa-1"] },
    };
    expect(issues(clash).map((i) => i.path)).toEqual(["registers.kasa_1"]);
    expect(registerEnvId("pos.2-b")).toBe("POS_2_B");
  });

  test("production endpoints must be https", () => {
    expect(
      issues({ ...BASE, productionEndpoint: "http://eet.example" }).map((i) => i.path),
    ).toEqual(["productionEndpoint"]);
  });
});
