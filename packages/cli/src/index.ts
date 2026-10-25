/**
 * @eet-gateway/cli — the `eet` command over the same core, ingest, queue and server. `run` takes
 * argv and an I/O object, so other tools can embed or test it. Commands: docs/CLI.md.
 */

export { type CliIO, EXIT, type GatewayHandle, UsageError } from "./context.ts";
export { HELP, run, VERSION } from "./run.ts";
