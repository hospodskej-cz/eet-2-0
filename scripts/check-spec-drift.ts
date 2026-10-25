/**
 * Re-downloads every official source listed in docs/sources/sources.json and reports drift:
 * a changed SHA-256, a document that disappeared, or a new/removed document link on the
 * eet.gov.cz listing pages (so e.g. "rozhraní v1.3" is noticed even under a new file name).
 *
 * Exit code: 0 = no drift, 1 = drift detected, 2 = could not check (network/HTTP failure).
 * Run: bun scripts/check-spec-drift.ts
 */
import { extractDocumentLinks, loadSources, sha256Hex, sourceUrl } from "./lib/sources.ts";

const TIMEOUT_MS = 30_000;

type Check =
  | { kind: "ok"; label: string }
  | { kind: "drift"; label: string; detail: string }
  | { kind: "error"; label: string; detail: string };

async function download(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
}

const manifest = await loadSources();
const checks: Check[] = [];

for (const source of manifest.sources) {
  const url = sourceUrl(manifest, source);
  try {
    const response = await download(url);
    if (response.status === 404) {
      checks.push({ kind: "drift", label: source.file, detail: "removed (HTTP 404)" });
      continue;
    }
    if (!response.ok) {
      checks.push({ kind: "error", label: source.file, detail: `HTTP ${response.status}` });
      continue;
    }
    const actual = sha256Hex(await response.arrayBuffer());
    checks.push(
      actual === source.sha256
        ? { kind: "ok", label: source.file }
        : { kind: "drift", label: source.file, detail: `sha256 ${source.sha256} -> ${actual}` },
    );
  } catch (error) {
    checks.push({ kind: "error", label: source.file, detail: String(error) });
  }
}

const found = new Set<string>();
for (const page of manifest.listing.pages) {
  try {
    const response = await download(page);
    if (!response.ok) {
      checks.push({ kind: "error", label: page, detail: `HTTP ${response.status}` });
      continue;
    }
    for (const link of extractDocumentLinks(await response.text())) found.add(link);
  } catch (error) {
    checks.push({ kind: "error", label: page, detail: String(error) });
  }
}

const known = new Set(manifest.listing.knownLinks);
for (const link of [...found].filter((l) => !known.has(l)).sort()) {
  checks.push({ kind: "drift", label: link, detail: "new document link on eet.gov.cz" });
}
if (!checks.some((c) => c.kind === "error" && c.label.startsWith("https://"))) {
  for (const link of [...known].filter((l) => !found.has(l)).sort()) {
    checks.push({ kind: "drift", label: link, detail: "no longer linked from listing pages" });
  }
}

for (const check of checks) {
  const mark = check.kind === "ok" ? "ok   " : check.kind === "drift" ? "DRIFT" : "ERROR";
  console.log(`${mark} ${check.label}${"detail" in check ? ` — ${check.detail}` : ""}`);
}

if (checks.some((c) => c.kind === "drift")) {
  console.log(
    "\nOfficial sources changed. Review the documents, update docs/SPEC_NOTES.md and docs/sources/sources.json.",
  );
  process.exit(1);
}
if (checks.some((c) => c.kind === "error")) process.exit(2);
console.log(`\nNo drift since ${manifest.retrievedAt}.`);
