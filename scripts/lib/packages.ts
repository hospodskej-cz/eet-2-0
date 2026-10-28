// The publishable packages, in dependency order (a package only depends on earlier ones).
import { join } from "node:path";

export const PACKAGES = ["core", "ingest", "queue", "server", "cli"] as const;
export type PackageName = (typeof PACKAGES)[number];

export const ROOT = join(import.meta.dir, "..", "..");

export function packageDir(name: PackageName): string {
  return join(ROOT, "packages", name);
}

export function isPackageName(value: string): value is PackageName {
  return (PACKAGES as readonly string[]).includes(value);
}

/** The requested packages plus everything they depend on (workspace dependencies), in order. */
export async function withDependencies(requested: readonly PackageName[]): Promise<PackageName[]> {
  const wanted = new Set<PackageName>(requested);
  for (const name of [...PACKAGES].reverse()) {
    if (!wanted.has(name)) continue;
    const manifest = await Bun.file(join(packageDir(name), "package.json")).json();
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      const short = dep.replace(/^@eet-gateway\//, "");
      if (dep.startsWith("@eet-gateway/") && isPackageName(short)) wanted.add(short);
    }
  }
  return PACKAGES.filter((name) => wanted.has(name));
}

export async function releaseVersion(): Promise<string> {
  return (await Bun.file(join(ROOT, "version.txt")).text()).trim();
}
