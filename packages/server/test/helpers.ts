import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CACHE = join(REPO_ROOT, ".cache/playground");
/** Shared playground certificate (`bun run certs:playground`). */
export const PG_P12 = join(CACHE, "CA_EET-Playground-CZ00000019.p12");
export const PG_PASSWORD_FILE = join(CACHE, "password_pokladni_cert_playground.txt");
export const API_KEY = "test-api-key-0123456789";

export function tempDir(prefix = "eet-server-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A minimal valid configuration for one playground register. */
export function pgConfig(overrides: Record<string, unknown> = {}) {
  return {
    apiKeys: [API_KEY],
    registers: {
      "kasa-1": {
        environment: "playground",
        certificates: [{ p12: PG_P12, passwordFile: PG_PASSWORD_FILE }],
        defaults: { id_jednotky: 11, id_pokl: "KASA-1" },
      },
    },
    ...overrides,
  };
}

export function writeYaml(dir: string, name: string, yaml: string): string {
  const path = join(dir, name);
  writeFileSync(path, yaml);
  return path;
}
