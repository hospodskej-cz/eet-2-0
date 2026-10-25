import { parse } from "../args.ts";
import { type CliIO, EXIT, UsageError } from "../context.ts";
import { readInput } from "../input.ts";
import { json, saleLines, sourceProblems, summary } from "../output.ts";
import { cliLogger } from "./shared.ts";

export const SEND_HELP = `Použití: eet send <soubor|-> [volby]

Ověří tržby ze souboru (nebo ze stdin), uloží je do fronty a odešle do EET, řádek po řádku.
Co neskončí přijetím, zůstává ve frontě pro "eet serve" nebo "eet queue flush". Opakované
spuštění nad stejným souborem nic neodešle dvakrát.

Volby:
  --format csv|json|ndjson|xml   formát (jinak podle přípony; u stdin povinný)
  --register ID                  pokladna (řádek může určit vlastní polem register)
  --verify                       ověřovací mód: EET zprávu zkontroluje a nic neeviduje
  --config cesta                 konfigurace (jinak EET_CONFIG, jinak ./eet.config.yaml)
  --json                         výsledek jako JSON
  --verbose                      vypsat i úpravy vstupu a průběh fronty (stderr)

Exit: 0 vše přijato, 3 něco nebylo přijato, 1 chyba, 2 špatné použití.
`;

export async function send(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {
    format: { type: "string" },
    register: { type: "string" },
    verify: { type: "boolean" },
  });
  if (values.help) {
    io.stdout(SEND_HELP);
    return EXIT.OK;
  }
  if (positionals.length > 1) throw new UsageError("čekám jeden soubor");
  const input = await readInput(io, positionals[0], values.format);
  const gateway = await io.openGateway({
    configPath: values.config,
    server: false,
    logger: cliLogger(io, values.verbose === true),
  });
  try {
    const result = await gateway.queue.submitBatch(input.source, input.format, {
      mode: "sync",
      verify: values.verify === true,
      register: values.register,
    });
    if (values.json) {
      io.stdout(json(result));
    } else {
      io.stdout(sourceProblems(result.issues, result.warnings));
      for (const { row, result: sale } of result.rows)
        io.stdout(saleLines(`řádek ${row}`, sale, values.verbose === true));
      io.stdout(summary(result.rows.map((r) => r.result.status)));
    }
    const allOk = result.rows.every(
      (r) => r.result.status === "accepted" || r.result.status === "verification_ok",
    );
    return result.issues.length === 0 && allOk ? EXIT.OK : EXIT.NOT_ALL_OK;
  } finally {
    await gateway.close();
  }
}
