// Builds the publishable packages into packages/<name>/dist: plain ESM JavaScript plus .d.ts,
// compiled file by file with tsc (no bundling, so dependencies stay real imports).
//   bun run build                  all packages
//   bun run build:queue            queue and what it depends on (core, ingest)
//   bun scripts/build-packages.ts core cli
//
// Sources import "./x.ts"; tsc rewrites that to "./x.js" in the JavaScript
// (rewriteRelativeImportExtensions) but leaves it in the .d.ts, which we fix up here, because
// consumers' TypeScript would not resolve "./x.ts" inside a .d.ts file.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import {
  isPackageName,
  PACKAGES,
  type PackageName,
  packageDir,
  withDependencies,
} from "./lib/packages.ts";

const RELATIVE_TS_SPECIFIER =
  /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["']))(\.{1,2}\/[^"']*?)\.ts(\2)/g;

async function declarationFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".d.ts"))
      found.push(join(entry.parentPath, entry.name));
  }
  return found;
}

export async function buildPackage(name: PackageName): Promise<void> {
  const dir = packageDir(name);
  await $`rm -rf ${join(dir, "dist")}`;
  await $`bun run tsc -p ${join(dir, "tsconfig.build.json")}`;
  let rewritten = 0;
  for (const file of await declarationFiles(join(dir, "dist"))) {
    const text = await Bun.file(file).text();
    const fixed = text.replace(RELATIVE_TS_SPECIFIER, "$1$3.js$4");
    if (fixed !== text) {
      await Bun.write(file, fixed);
      rewritten++;
    }
  }
  console.log(`built @eet-gateway/${name} (${rewritten} .d.ts files rewritten)`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (!isPackageName(arg)) {
      console.error(`unknown package ${arg} (${PACKAGES.join(", ")})`);
      process.exit(2);
    }
  }
  const requested = args.length === 0 ? [...PACKAGES] : (args as PackageName[]);
  for (const name of await withDependencies(requested)) await buildPackage(name);
}
