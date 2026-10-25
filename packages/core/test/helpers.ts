import { fileURLToPath } from "node:url";
import { loadPkcs12, type RegisterCertificate } from "../src/index.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function repoPath(relative: string): string {
  return `${REPO_ROOT}${relative}`;
}

export async function repoBytes(relative: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(repoPath(relative)).arrayBuffer());
}

export const PLAYGROUND_EICS = ["CZ00000019", "CZ683555118", "CZ8551015704"] as const;

/** Shared playground certificates published by GFŘ; fetched by `bun run certs:playground`. */
export async function loadPlaygroundCertificate(
  eic: (typeof PLAYGROUND_EICS)[number] = "CZ00000019",
): Promise<RegisterCertificate> {
  const dir = repoPath(".cache/playground/");
  const p12 = Bun.file(`${dir}CA_EET-Playground-${eic}.p12`);
  if (!(await p12.exists())) {
    throw new Error("playground certificates missing — run `bun run certs:playground` first");
  }
  const password = (await Bun.file(`${dir}password_pokladni_cert_playground.txt`).text()).trim();
  return loadPkcs12(new Uint8Array(await p12.arrayBuffer()), password);
}

/** Attributes of the first `<prefix:element …/>` in `xml`, or undefined if it is absent. */
export function xmlAttributes(xml: string, element: string): Record<string, string> | undefined {
  const tag = new RegExp(`<(?:[\\w.-]+:)?${element}\\b([^>]*?)/?>`).exec(xml);
  if (tag === null) return undefined;
  const attributes: Record<string, string> = {};
  for (const m of (tag[1] ?? "").matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    if (m[1] !== undefined && m[2] !== undefined && !m[1].startsWith("xmlns"))
      attributes[m[1]] = m[2];
  }
  return attributes;
}

/** Maps XSD lexical booleans to JS booleans; anything else stays a string (and must fail). */
export function xsdBooleans(
  attributes: Record<string, string>,
  names: readonly string[],
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { ...attributes };
  for (const name of names) {
    const value = attributes[name];
    if (value === "true" || value === "1") out[name] = true;
    else if (value === "false" || value === "0") out[name] = false;
  }
  return out;
}

export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}
