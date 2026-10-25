import { createLogger, type Logger } from "@eet-gateway/server";
import type { CliIO } from "../context.ts";

/** Queue progress as JSON lines on stderr with --verbose; silent otherwise. */
export function cliLogger(io: CliIO, verbose: boolean): Logger {
  return verbose ? createLogger((line) => io.stderr(`${line}\n`)) : { log() {} };
}
