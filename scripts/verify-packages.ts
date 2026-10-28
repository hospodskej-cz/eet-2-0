// Verifies the npm tarballs made by `bun run pack:packages` before anything is published.
//   bun run verify:packages [dir]        (default dist/npm)
//
// 1. Static: no `workspace:` specifier anywhere, version == version.txt, every exports/main/
//    types/bin target exists, only dist/ + LICENSE + README + package.json, no secrets, no
//    "./x.ts" imports left in .d.ts, no Bun-only API in the Node-compatible packages.
// 2. Install all tarballs into an empty temp project with npm (the internal dependencies are
//    pointed at the tarballs through `overrides`, as they are not on the registry yet).
// 3. Under Node: the compat smoke tests of core, ingest and queue run against the installed
//    packages, and every package's root export loads; under Bun: `eet --version`.
// 4. A TypeScript consumer (module nodenext, skipLibCheck off) type-checks against the .d.ts.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { PACKAGES, type PackageName, ROOT, releaseVersion } from "./lib/packages.ts";

const dir = process.argv[2] ?? join(ROOT, "dist", "npm");
const version = await releaseVersion();
const problems: string[] = [];
const fail = (message: string) => problems.push(message);

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  publishConfig?: { access?: string; provenance?: boolean };
  repository?: { url?: string };
};

const NODE_COMPATIBLE: readonly PackageName[] = ["core", "ingest", "queue"];
const SECRET_NAME = /\.(p12|pfx|pem|key|db|sqlite3?|env)$|(^|\/)\.env|eet\.config\.yaml$/;
const decoder = new TextDecoder();

function exportTargets(exports: Manifest["exports"]): string[] {
  const targets: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(exports);
  return targets;
}

const tarballs = new Map<PackageName, string>();

for (const name of PACKAGES) {
  const file = join(dir, `eet-gateway-${name}-${version}.tgz`);
  if (!(await Bun.file(file).exists())) {
    fail(`${basename(file)} is missing (run: bun run pack:packages)`);
    continue;
  }
  tarballs.set(name, file);
  const files = await new Bun.Archive(await Bun.file(file).bytes()).files();
  const entries = new Map<string, Uint8Array>();
  for (const [path, blob] of files) entries.set(path.replace(/^package\//, ""), await blob.bytes());

  const tag = `@eet-gateway/${name}`;
  const rawManifest = entries.get("package.json");
  if (!rawManifest) {
    fail(`${tag}: no package.json in the tarball`);
    continue;
  }
  const text = decoder.decode(rawManifest);
  const manifest = JSON.parse(text) as Manifest;
  if (text.includes("workspace:")) fail(`${tag}: package.json still has a workspace: specifier`);
  if (manifest.name !== tag) fail(`${tag}: name is ${manifest.name}`);
  if (manifest.version !== version) fail(`${tag}: version ${manifest.version} != ${version}`);
  if (manifest.private) fail(`${tag}: private`);
  if (manifest.license !== "MIT") fail(`${tag}: license ${manifest.license}`);
  if (manifest.publishConfig?.access !== "public")
    fail(`${tag}: publishConfig.access is not public`);
  if (manifest.publishConfig?.provenance !== true)
    fail(`${tag}: publishConfig.provenance is not true`);
  if (!manifest.repository?.url?.includes("hospodskej-cz/eet-2-0")) fail(`${tag}: repository.url`);
  for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
    if (dep.startsWith("@eet-gateway/") && range !== `^${version}`) {
      fail(`${tag}: ${dep} is "${range}", expected "^${version}"`);
    }
  }
  const referenced = [
    ...exportTargets(manifest.exports),
    ...(manifest.main ? [manifest.main] : []),
    ...(manifest.types ? [manifest.types] : []),
    ...Object.values(manifest.bin ?? {}),
  ].filter((target) => target !== "./package.json");
  for (const target of referenced) {
    if (!entries.has(target.replace(/^\.\//, ""))) fail(`${tag}: ${target} is not in the tarball`);
  }
  for (const [path, bytes] of entries) {
    const known =
      path === "package.json" ||
      path === "LICENSE" ||
      path === "README.md" ||
      path.startsWith("dist/");
    if (!known) fail(`${tag}: unexpected file ${path}`);
    if (SECRET_NAME.test(path)) fail(`${tag}: looks like a secret: ${path}`);
    if (path.endsWith(".ts") && !path.endsWith(".d.ts")) fail(`${tag}: TypeScript source ${path}`);
    const source = decoder.decode(bytes);
    if (path.endsWith(".d.ts") && /\bfrom\s*["']\.{1,2}\/[^"']*\.ts["']/.test(source)) {
      fail(`${tag}: ${path} imports a ".ts" path`);
    }
    if (NODE_COMPATIBLE.includes(name) && path.endsWith(".js") && /\bBun\.|["']bun:/.test(source)) {
      fail(`${tag}: ${path} uses a Bun-only API`);
    }
  }
  const main = decoder.decode(entries.get("dist/main.js") ?? new Uint8Array());
  if (name === "cli" && !main.startsWith("#!/usr/bin/env bun")) {
    fail(`${tag}: dist/main.js lost its shebang`);
  }
  const kib = (Bun.file(file).size / 1024).toFixed(0);
  console.log(`ok  static   ${tag}@${manifest.version}  ${entries.size} files  ${kib} KiB`);
}

if (problems.length === 0) {
  const work = await mkdtemp(join(tmpdir(), "eet-gateway-verify-"));
  try {
    await mkdir(join(work, "tarballs"));
    const overrides: Record<string, string> = {};
    for (const [name, file] of tarballs) {
      await Bun.write(join(work, "tarballs", basename(file)), Bun.file(file));
      overrides[`@eet-gateway/${name}`] = `file:./tarballs/${basename(file)}`;
    }
    const project = {
      name: "verify",
      private: true,
      type: "module",
      dependencies: overrides,
      overrides,
    };
    await writeFile(join(work, "package.json"), JSON.stringify(project, null, 2));
    await $`npm install --ignore-scripts --no-audit --no-fund --loglevel=error`.cwd(work);
    console.log("ok  install  all tarballs into an empty project with npm");

    // The packages are imported by name from the installed copies, never from the checkout.
    for (const name of NODE_COMPATIBLE) {
      const smokePath = join(ROOT, "packages", name, "test", "compat", "smoke.mjs");
      const smoke = (await readFile(smokePath, "utf8")).replace(
        "../../dist/index.js",
        `@eet-gateway/${name}`,
      );
      await writeFile(join(work, `smoke-${name}.mjs`), smoke);
      await $`node smoke-${name}.mjs`.cwd(work).quiet();
      console.log(`ok  node     compat smoke of @eet-gateway/${name} on the installed tarball`);
    }
    const check = `import assert from "node:assert/strict";
import * as core from "@eet-gateway/core";
import * as ingest from "@eet-gateway/ingest";
import * as queue from "@eet-gateway/queue";
import * as server from "@eet-gateway/server";
import * as cli from "@eet-gateway/cli";
for (const [name, mod] of Object.entries({ core, ingest, queue, server, cli })) {
  assert.equal(mod.VERSION, ${JSON.stringify(version)}, name + " VERSION");
}
// The runtime-neutral HTTP app answers in-process on Node, backed by the in-memory queue store.
const queueInstance = queue.createEetQueue({ store: queue.createMemoryStore(), registers: {} });
const app = server.createApp({ queue: queueInstance, apiKeys: ["verify-key-0123456789"], registers: () => [] });
const openapi = await (await app.request("/openapi.json")).json();
assert.equal(openapi.info.version, ${JSON.stringify(version)});
assert.equal((await app.request("/health")).status, 200);
`;
    await writeFile(join(work, "versions.mjs"), check);
    await $`node versions.mjs`.cwd(work).quiet();
    console.log("ok  node     every package loads and reports the release version");

    const cliMain = join(work, "node_modules", "@eet-gateway", "cli", "dist", "main.js");
    const cliVersion = (await $`bun ${cliMain} --version`.cwd(work).text()).trim();
    if (!cliVersion.includes(version)) fail(`eet --version printed "${cliVersion}"`);
    else console.log(`ok  bun      eet --version -> ${cliVersion}`);

    const consumer = `import { createEetTransport, type EetReceiptData, loadPkcs12 } from "@eet-gateway/core";
import { parseSales } from "@eet-gateway/ingest";
import { createEetQueue, createMemoryStore, type EetQueue } from "@eet-gateway/queue";
import { createApp } from "@eet-gateway/server";
import { openGateway } from "@eet-gateway/server/serve";
import { run } from "@eet-gateway/cli";
export const used = [createEetTransport, loadPkcs12, parseSales, createEetQueue, createMemoryStore, createApp, openGateway, run];
export type Used = EetReceiptData | EetQueue;
`;
    await writeFile(join(work, "consumer.ts"), consumer);
    const compilerOptions = {
      module: "nodenext",
      moduleResolution: "nodenext",
      target: "ES2023",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    };
    await writeFile(
      join(work, "tsconfig.json"),
      JSON.stringify({ compilerOptions, include: ["consumer.ts"] }),
    );
    const tsc = await $`bun run tsc -p ${join(work, "tsconfig.json")}`.cwd(ROOT).nothrow().quiet();
    if (tsc.exitCode !== 0) {
      fail(
        `TypeScript consumer does not compile:\n${tsc.stdout.toString()}${tsc.stderr.toString()}`,
      );
    } else
      console.log(
        "ok  types    a nodenext consumer compiles against every .d.ts (skipLibCheck off)",
      );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nall ${PACKAGES.length} tarballs verified for ${version}`);
