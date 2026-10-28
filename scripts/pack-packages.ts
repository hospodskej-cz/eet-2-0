// Builds the packages and packs them into npm tarballs in dist/npm/ (one .tgz per package).
//   bun run pack:packages
//
// Each tarball is made from a staging directory in .cache/pack/<name>/ holding only what is
// published: dist/, a package.json with the workspace dependencies turned into real semver
// ranges, LICENSE and a README.md. The packages' own package.json files keep `workspace:*`
// (so Bun links the sources during development) and that is never published as is: npm does not
// understand the `workspace:` protocol, and Bun has no npm trusted publishing (OIDC). The publish
// job uploads these tarballs with `npm publish <tarball> --provenance`; scripts/verify-packages.ts
// checks them first.

import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { buildPackage } from "./build-packages.ts";
import { PACKAGES, type PackageName, packageDir, ROOT, releaseVersion } from "./lib/packages.ts";

const REPO_URL = "https://github.com/hospodskej-cz/eet-2-0";
const DOCS: Record<PackageName, string> = {
  core: "docs/ADR-001-protocol-core.md",
  ingest: "docs/INGEST.md",
  queue: "docs/QUEUE.md",
  server: "docs/SERVER.md",
  cli: "docs/CLI.md",
};

type Manifest = Record<string, unknown> & {
  name: string;
  version: string;
  description: string;
  dependencies?: Record<string, string>;
};

/** `workspace:*` / `workspace:^` / `workspace:~` → a caret range of the lockstep release version. */
function publishedRange(spec: string, version: string): string {
  if (!spec.startsWith("workspace:")) return spec;
  const range = spec.slice("workspace:".length);
  if (range === "*" || range === "^") return `^${version}`;
  if (range === "~") return `~${version}`;
  return range;
}

export function publishedManifest(manifest: Manifest, version: string): Manifest {
  const { devDependencies: _dev, scripts: _scripts, private: _private, ...rest } = manifest;
  const published: Manifest = { ...rest, version };
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"] as const) {
    const deps = published[field] as Record<string, string> | undefined;
    if (!deps) continue;
    published[field] = Object.fromEntries(
      Object.entries(deps).map(([name, spec]) => [name, publishedRange(spec, version)]),
    );
  }
  return published;
}

function readme(manifest: Manifest, name: PackageName): string {
  return `# ${manifest.name}

${manifest.description}

Part of [EET Gateway](${REPO_URL}): an open-source (MIT) gateway for sending sales to the
Czech EET 2.0 (SOAP interface 4.1). Documentation: [${DOCS[name]}](${REPO_URL}/blob/main/${DOCS[name]}).

\`\`\`sh
npm install ${manifest.name}
\`\`\`

Released together with the other \`@eet-gateway/*\` packages and the \`eet\` binaries; the
version is the same everywhere. See the [changelog](${REPO_URL}/blob/main/CHANGELOG.md).
Packages carry npm provenance: \`npm audit signatures\` checks it.
`;
}

async function stage(name: PackageName, version: string): Promise<string> {
  const source = packageDir(name);
  const manifest = (await Bun.file(join(source, "package.json")).json()) as Manifest;
  if (manifest.version !== version) {
    throw new Error(
      `${manifest.name} is ${manifest.version} but version.txt says ${version} (release-please bumps both)`,
    );
  }
  const dir = join(ROOT, ".cache", "pack", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(join(source, "dist"), join(dir, "dist"), { recursive: true });
  await cp(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
  const ownReadme = Bun.file(join(source, "README.md"));
  if (await ownReadme.exists()) await Bun.write(join(dir, "README.md"), ownReadme);
  else await Bun.write(join(dir, "README.md"), readme(manifest, name));
  await Bun.write(
    join(dir, "package.json"),
    `${JSON.stringify(publishedManifest(manifest, version), null, 2)}\n`,
  );
  return dir;
}

if (import.meta.main) {
  const version = await releaseVersion();
  const out = join(ROOT, "dist", "npm");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const name of PACKAGES) await buildPackage(name);
  const order: string[] = [];
  for (const name of PACKAGES) {
    const dir = await stage(name, version);
    await $`npm pack --pack-destination ${out} --silent`.cwd(dir).quiet();
    order.push(`eet-gateway-${name}-${version}.tgz`);
  }
  // Dependencies first, so a package is never on the registry before what it depends on.
  await Bun.write(join(out, "publish-order.txt"), `${order.join("\n")}\n`);
  console.log(`packed ${PACKAGES.length} tarballs for ${version} into ${out}`);
}
