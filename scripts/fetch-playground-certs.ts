/**
 * Downloads the shared playground cash-register certificates published by GFŘ
 * (CAEET_Playground_2026_v1.zip), verifies the SHA-256 recorded in docs/sources/sources.json
 * and unpacks them into .cache/playground/ (gitignored).
 *
 * The .p12 files hold private keys. They are public test credentials, but they are still never
 * committed, logged or copied into build output (docs/SPEC_NOTES.md §12).
 * Requires the `unzip` command. Run: bun scripts/fetch-playground-certs.ts
 */
import { mkdir } from "node:fs/promises";
import { loadSources, repoPath, sha256Hex, sourceUrl } from "./lib/sources.ts";

const EXPECTED_FILES = [
  "CA_EET-Playground-CZ00000019.p12",
  "CA_EET-Playground-CZ683555118.p12",
  "CA_EET-Playground-CZ8551015704.p12",
  "password_pokladni_cert_playground.txt",
] as const;

const manifest = await loadSources();
const source = manifest.sources.find((s) => s.id === "pg-certs");
if (source === undefined) throw new Error("docs/sources/sources.json has no 'pg-certs' entry");

const outDir = repoPath(".cache/playground/");
const zipPath = `${outDir}${source.file}`;
await mkdir(outDir, { recursive: true });

const cached = Bun.file(zipPath);
const cachedOk = (await cached.exists()) && sha256Hex(await cached.arrayBuffer()) === source.sha256;

if (!cachedOk) {
  const url = sourceUrl(manifest, source);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actual = sha256Hex(bytes);
  if (actual !== source.sha256) {
    throw new Error(
      `${source.file}: sha256 ${actual} does not match ${source.sha256} — upstream changed, run bun run spec:drift`,
    );
  }
  await Bun.write(zipPath, bytes);
}

const unzip = Bun.spawnSync(["unzip", "-o", "-q", zipPath, "-d", outDir]);
if (unzip.exitCode !== 0) {
  throw new Error(`unzip failed (${unzip.exitCode}): ${unzip.stderr.toString()}`);
}

for (const name of EXPECTED_FILES) {
  if (!(await Bun.file(`${outDir}${name}`).exists())) {
    throw new Error(`${source.file} does not contain ${name}`);
  }
}

console.log(`Playground certificates ready in ${outDir}`);
for (const name of EXPECTED_FILES) console.log(`  ${name}`);
