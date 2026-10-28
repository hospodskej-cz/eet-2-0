// CycloneDX 1.5 SBOM of what goes into the `eet` binaries and the packages: the production
// dependency closure of packages/cli, read from bun.lock (integrity hashes) and node_modules
// (licenses, when installed). Offline and deterministic apart from the timestamp and serial.
//   bun run gen:sbom [out]        (default dist/bin/eet-gateway.cdx.json)
// npm's own `npm sbom` cannot read Bun's node_modules tree cleanly, hence this script.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PACKAGES, ROOT, releaseVersion } from "./lib/packages.ts";

type LockEntry = [
  ident: string,
  registry: string,
  meta: Record<string, unknown>,
  integrity?: string,
];
type Lock = {
  workspaces: Record<
    string,
    { name?: string; version?: string; dependencies?: Record<string, string> }
  >;
  packages: Record<string, LockEntry>;
};

const BUN_VERSION = (await Bun.file(join(ROOT, ".bun-version")).text()).trim();
const out = process.argv[2] ?? join(ROOT, "dist", "bin", "eet-gateway.cdx.json");
const version = await releaseVersion();
const lock = Bun.JSONC.parse(await Bun.file(join(ROOT, "bun.lock")).text()) as Lock;

const purl = (name: string, ver: string) =>
  `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${ver}`;
const splitIdent = (ident: string) => {
  const at = ident.lastIndexOf("@");
  return { name: ident.slice(0, at), version: ident.slice(at + 1) };
};

/** Lock key under which `dep`, required by the package at `parentKey`, is installed. */
function resolveKey(parentKey: string | undefined, dep: string): string | undefined {
  if (parentKey !== undefined && lock.packages[`${parentKey}/${dep}`]) return `${parentKey}/${dep}`;
  return lock.packages[dep] ? dep : undefined;
}

type Component = {
  type: string;
  "bom-ref": string;
  name: string;
  version: string;
  purl?: string;
  scope?: string;
  hashes?: { alg: string; content: string }[];
  licenses?: { license: { id?: string; name?: string } }[];
};
const components = new Map<string, Component>();
const edges = new Map<string, Set<string>>();

async function licenseOf(key: string): Promise<Component["licenses"]> {
  // Bun hoists to the root when it can and otherwise installs next to the workspace package.
  for (const base of ["", ...PACKAGES.map((name) => join("packages", name))]) {
    const manifest = Bun.file(join(ROOT, base, "node_modules", key, "package.json"));
    if (!(await manifest.exists())) continue;
    const license = ((await manifest.json()) as { license?: unknown }).license;
    return typeof license === "string" && license ? [{ license: { id: license } }] : undefined;
  }
  return undefined;
}

async function visit(key: string, requiredBy: string | undefined): Promise<string> {
  const entry = lock.packages[key];
  if (!entry) throw new Error(`bun.lock has no entry ${key}`);
  const { name, version: ver } = splitIdent(entry[0]);
  const isWorkspace = ver.startsWith("workspace:");
  const resolved = isWorkspace
    ? (
        (await Bun.file(join(ROOT, ver.slice("workspace:".length), "package.json")).json()) as {
          version: string;
        }
      ).version
    : ver;
  const ref = purl(name, resolved);
  if (requiredBy) edges.get(requiredBy)?.add(ref);
  if (components.has(ref)) return ref;
  const component: Component = {
    type: "library",
    "bom-ref": ref,
    name,
    version: resolved,
    purl: ref,
    scope: "required",
  };
  const integrity = entry[3];
  if (integrity?.startsWith("sha512-")) {
    const content = Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex");
    component.hashes = [{ alg: "SHA-512", content }];
  }
  const licenses = isWorkspace ? [{ license: { id: "MIT" } }] : await licenseOf(key);
  if (licenses) component.licenses = licenses;
  components.set(ref, component);
  edges.set(ref, new Set());
  const deps = isWorkspace
    ? (lock.workspaces[ver.slice("workspace:".length)]?.dependencies ?? {})
    : ((entry[2]["dependencies"] as Record<string, string> | undefined) ?? {});
  for (const dep of Object.keys(deps)) {
    const depKey = resolveKey(isWorkspace ? undefined : key, dep);
    if (!depKey) throw new Error(`${name} needs ${dep}, which bun.lock does not list`);
    await visit(depKey, ref);
  }
  return ref;
}

const app = `pkg:generic/eet@${version}`;
edges.set(app, new Set());
const cliDeps = lock.workspaces["packages/cli"]?.dependencies ?? {};
for (const dep of Object.keys(cliDeps)) await visit(dep, app);

// The binaries embed the Bun runtime (bun build --compile).
const bunRef = `pkg:generic/bun@${BUN_VERSION}`;
components.set(bunRef, {
  type: "framework",
  "bom-ref": bunRef,
  name: "bun",
  version: BUN_VERSION,
  purl: bunRef,
  scope: "required",
  licenses: [{ license: { name: "See https://bun.sh/docs/project/licensing" } }],
});
edges.get(app)?.add(bunRef);

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: "application", name: "scripts/gen-sbom.ts", version }] },
    component: {
      type: "application",
      "bom-ref": app,
      name: "eet",
      version,
      description: "EET Gateway command-line binary",
      purl: app,
      licenses: [{ license: { id: "MIT" } }],
      externalReferences: [{ type: "vcs", url: "https://github.com/hospodskej-cz/eet-2-0" }],
    },
  },
  components: [...components.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"])),
  dependencies: [...edges].map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
};
await mkdir(dirname(out), { recursive: true });
await Bun.write(out, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`${out}: ${components.size} components`);
