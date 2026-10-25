import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { UsageError } from "./context.ts";

/** Options every command accepts. */
export const GLOBAL_OPTIONS = {
  config: { type: "string" },
  json: { type: "boolean" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;

export function parse<const T extends ParseArgsOptionsConfig>(args: string[], options: T) {
  try {
    return parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}
