import { fileURLToPath } from "node:url";

/** One official document listed in docs/sources/sources.json. */
export interface Source {
  readonly id: string;
  readonly title: string;
  /** Short name used in docs citations, e.g. "Rozhraní §3.3.3.12". */
  readonly cite: string;
  readonly version: string | null;
  readonly date: string | null;
  /** File name under `baseUrl`. */
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number | null;
  /** Traffic Light Protocol marking printed on the document, if any. */
  readonly tlp: "AMBER" | null;
  /** Repository-relative path of a byte-for-byte copy, if the file is vendored. */
  readonly vendored: string | null;
}

export interface SourcesManifest {
  readonly retrievedAt: string;
  readonly baseUrl: string;
  readonly sources: readonly Source[];
  readonly listing: {
    readonly pages: readonly string[];
    readonly knownLinks: readonly string[];
  };
}

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function repoPath(relative: string): string {
  return `${REPO_ROOT}${relative}`;
}

export async function loadSources(): Promise<SourcesManifest> {
  return (await Bun.file(repoPath("docs/sources/sources.json")).json()) as SourcesManifest;
}

export function sourceUrl(manifest: SourcesManifest, source: Source): string {
  return new URL(source.file, manifest.baseUrl).href;
}

export function sha256Hex(data: ArrayBuffer | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/** File names of every `/assets/cs/cmsmedia/pro-vyvojare/<file>` link in an HTML page. */
export function extractDocumentLinks(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/\/assets\/cs\/cmsmedia\/pro-vyvojare\/([^"'?#\s]+)/g)) {
    const file = match[1];
    if (file !== undefined) links.add(decodeURIComponent(file));
  }
  return [...links].sort();
}
