#!/usr/bin/env bun
// The `eet` command (docs/CLI.md); compiled into standalone binaries by scripts/build-binaries.ts.
import { openGateway, serveUntilSignal } from "@eet-gateway/server/serve";
import type { CliIO } from "./context.ts";
import { promptHidden } from "./password.ts";
import { run } from "./run.ts";

async function readFile(path: string): Promise<Uint8Array> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`soubor ${path} neexistuje`);
  return new Uint8Array(await file.arrayBuffer());
}

const io: CliIO = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  readStdin: async () => new Uint8Array(await Bun.stdin.arrayBuffer()),
  readFile,
  fileExists: (path) => Bun.file(path).exists(),
  env: process.env,
  interactive: process.stdin.isTTY === true,
  promptHidden,
  openGateway,
  serve: serveUntilSignal,
  now: () => new Date(),
};

// Let pending output drain instead of cutting it off with process.exit().
process.exitCode = await run(process.argv.slice(2), io);
