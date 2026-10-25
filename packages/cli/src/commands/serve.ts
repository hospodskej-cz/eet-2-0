import { parse } from "../args.ts";
import { type CliIO, EXIT, UsageError } from "../context.ts";

export const SERVE_HELP = `Použití: eet serve [--config cesta] [--port N] [--dev]

Spustí HTTP API (docs/SERVER.md) včetně doposílání fronty na pozadí. Skončí na SIGTERM/SIGINT:
přestane přijímat, dokončí rozběhnuté pokusy a zavře databázi.

Volby:
  --config cesta   konfigurace (jinak EET_CONFIG, jinak ./eet.config.yaml)
  --port N         přepíše server.port (0 = libovolný volný)
  --dev            bez API klíčů, jen playground; nikdy nevystavovat

Logy jsou JSON řádky na stdout. Exit: 0 po čistém zastavení, 1 chyba konfigurace.
`;

export async function serve(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {
    port: { type: "string" },
    dev: { type: "boolean" },
  });
  if (values.help) {
    io.stdout(SERVE_HELP);
    return EXIT.OK;
  }
  if (positionals.length > 0) throw new UsageError(`nečekaný argument "${positionals[0]}"`);
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535))
    throw new UsageError("--port: 0–65535");
  return io.serve({ configPath: values.config, port, dev: values.dev === true });
}
