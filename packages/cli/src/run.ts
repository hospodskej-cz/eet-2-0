/** `eet <command> …` — dispatch, global options and exit codes (docs/CLI.md). */
import { CertificateError } from "@eet-gateway/core";
import { ConfigError } from "@eet-gateway/server";
import { cert } from "./commands/cert.ts";
import { queue } from "./commands/queue.ts";
import { send } from "./commands/send.ts";
import { serve } from "./commands/serve.ts";
import { validate } from "./commands/validate.ts";
import { type CliIO, EXIT, UsageError } from "./context.ts";

export const VERSION = "0.3.0"; // x-release-please-version

export const HELP = `eet — EET 2.0: odesílání tržeb, fronta, HTTP API (verze ${VERSION})

Příkazy:
  eet send <soubor|->           ověří, uloží a odešle tržby
  eet validate <soubor|->       jen zkontroluje, nic neodešle
  eet serve                     HTTP API s frontou (docs/SERVER.md)
  eet queue list|retry|flush    přehled fronty a ruční doposlání
  eet cert inspect <soubor.p12> EIČ, prostředí a platnost certifikátu

Volby všech příkazů: --config cesta, --json, --verbose, --help
Podrobnosti: eet <příkaz> --help, docs/CLI.md
`;

const COMMANDS: Readonly<Record<string, (args: string[], io: CliIO) => Promise<number>>> = {
  send,
  validate,
  serve,
  queue,
  cert,
};

export async function run(argv: readonly string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    io.stderr(HELP);
    return EXIT.USAGE;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    io.stdout(HELP);
    return EXIT.OK;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    io.stdout(`eet ${VERSION}\n`);
    return EXIT.OK;
  }
  const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (handler === undefined) {
    io.stderr(`Neznámý příkaz "${command}".\n\n${HELP}`);
    return EXIT.USAGE;
  }
  try {
    return await handler(rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`eet ${command}: ${error.message}\nNápověda: eet ${command} --help\n`);
      return EXIT.USAGE;
    }
    if (error instanceof ConfigError) {
      io.stderr(`${error.message}\n`);
      return EXIT.FAILURE;
    }
    if (error instanceof CertificateError) {
      io.stderr(`Certifikát: ${error.message}\n`);
      return EXIT.FAILURE;
    }
    io.stderr(`Chyba: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.FAILURE;
  }
}
