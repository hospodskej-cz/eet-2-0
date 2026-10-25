#!/usr/bin/env bun
// EET Gateway HTTP service: bun packages/server/src/main.ts [--config path] [--port n] [--dev]
// Exit codes: 0 after SIGTERM/SIGINT, 1 for a configuration problem, 2 for bad arguments.
import { parseArgs } from "node:util";
import { ConfigError } from "./config.ts";
import { serve } from "./serve.ts";

let args: ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>["values"];
const OPTIONS = {
  config: { type: "string" },
  port: { type: "string" },
  dev: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

try {
  args = parseArgs({ options: OPTIONS }).values;
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
if (args.help) {
  console.log(
    "Usage: eet-gateway [--config eet.config.yaml] [--port 8080] [--dev]\nConfiguration: docs/SERVER.md",
  );
  process.exit(0);
}
const port = args.port === undefined ? undefined : Number(args.port);
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
  console.error("--port: 0–65535");
  process.exit(2);
}

try {
  const server = await serve({ configPath: args.config, dev: args.dev, port });
  let signals = 0;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      signals += 1;
      if (signals > 1) process.exit(1); // a second signal: stop waiting
      server.stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : `Start selhal: ${String(error)}`);
  process.exit(1);
}
