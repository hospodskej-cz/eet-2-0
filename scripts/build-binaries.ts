// Standalone `eet` binaries (bun build --compile) into dist/bin/, with SHA256SUMS.
//   bun run build:binaries                 all targets (cross-compiled)
//   bun run build:binaries native          only this machine's
//   bun run build:binaries linux-x64 …     chosen targets
// .env and bunfig.toml in the working directory are NOT loaded by the binaries: EET_* settings
// must be set explicitly, so a stray file never changes what the gateway does.
import { $ } from "bun";

const TARGETS = ["linux-x64", "linux-arm64", "darwin-arm64", "windows-x64"] as const;
const native = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const wanted = process.argv.slice(2).map((t) => (t === "native" ? native : t));
const targets = wanted.length === 0 ? [...TARGETS] : wanted;
for (const target of targets) {
  if (!(TARGETS as readonly string[]).includes(target)) {
    console.error(`unknown target ${target} (${TARGETS.join(", ")}, native)`);
    process.exit(2);
  }
}

const sums: string[] = [];
for (const target of targets) {
  const name = `eet-${target}${target.startsWith("windows") ? ".exe" : ""}`;
  const outfile = `dist/bin/${name}`;
  await $`bun build packages/cli/src/main.ts --compile --target=bun-${target} --outfile ${outfile} --no-compile-autoload-dotenv --no-compile-autoload-bunfig`.quiet();
  const bytes = new Uint8Array(await Bun.file(outfile).arrayBuffer());
  const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  sums.push(`${sha}  ${name}`);
  console.log(`${outfile}  ${(bytes.length / 1e6).toFixed(1)} MB  sha256 ${sha}`);
}
await Bun.write("dist/bin/SHA256SUMS", `${sums.join("\n")}\n`);
