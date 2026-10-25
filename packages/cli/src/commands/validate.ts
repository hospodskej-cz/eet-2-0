import { parseSales } from "@eet-gateway/ingest";
import type { BatchValidationResult, ValidationResult } from "@eet-gateway/queue";
import { parse } from "../args.ts";
import { type CliIO, EXIT, UsageError } from "../context.ts";
import { readInput } from "../input.ts";
import { json, sourceProblems, summary, validationLines } from "../output.ts";
import { cliLogger } from "./shared.ts";

export const VALIDATE_HELP = `Použití: eet validate <soubor|-> [volby]

Zkontroluje tržby bez odeslání. S konfigurací (--config, EET_CONFIG nebo ./eet.config.yaml)
použije výchozí hodnoty pokladen přesně jako odeslání; bez ní jen převede a ověří vstup.
Nic se neuloží ani neodešle.

Volby:
  --format csv|json|ndjson|xml   formát (jinak podle přípony; u stdin povinný)
  --register ID                  pokladna (jen s konfigurací)
  --verify                       ověřovací mód
  --config cesta, --json, --verbose

Exit: 0 vše platné, 3 něco neplatné, 1 chyba, 2 špatné použití.
`;

export async function validate(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {
    format: { type: "string" },
    register: { type: "string" },
    verify: { type: "boolean" },
  });
  if (values.help) {
    io.stdout(VALIDATE_HELP);
    return EXIT.OK;
  }
  if (positionals.length > 1) throw new UsageError("čekám jeden soubor");
  const input = await readInput(io, positionals[0], values.format);
  const verify = values.verify === true;
  const withConfig =
    values.config !== undefined ||
    Boolean(io.env["EET_CONFIG"]) ||
    (await io.fileExists("eet.config.yaml"));

  let result: BatchValidationResult;
  if (withConfig) {
    const gateway = await io.openGateway({
      configPath: values.config,
      server: false,
      logger: cliLogger(io, values.verbose === true),
    });
    try {
      result = gateway.queue.validateBatch(input.source, input.format, {
        verify,
        register: values.register,
      });
    } finally {
      await gateway.close();
    }
  } else {
    if (values.register !== undefined)
      throw new UsageError("--register potřebuje konfiguraci (--config)");
    const parsed = parseSales(input.source, input.format);
    result = {
      rows: parsed.rows.map(({ row, result: r }) => ({
        row,
        result: (r.ok
          ? {
              valid: true,
              data: r.sale.data,
              overeni: r.sale.overeni || verify,
              prvni_zaslani: r.sale.prvni_zaslani,
              ...(r.sale.register !== undefined ? { register: r.sale.register } : {}),
              warnings: r.warnings,
              issues: [],
            }
          : { valid: false, warnings: r.warnings, issues: r.issues }) as ValidationResult,
      })),
      warnings: parsed.warnings,
      issues: parsed.issues,
    };
  }

  if (values.json) {
    io.stdout(json(result));
  } else {
    if (!withConfig) io.stderr("Bez konfigurace: výchozí hodnoty pokladen se nepoužijí.\n");
    io.stdout(sourceProblems(result.issues, result.warnings));
    for (const { row, result: r } of result.rows)
      io.stdout(validationLines(`řádek ${row}`, r, values.verbose === true));
    io.stdout(summary(result.rows.map((r) => (r.result.valid ? "platná" : "neplatná"))));
  }
  const allValid = result.rows.every((r) => r.result.valid);
  return result.issues.length === 0 && allValid ? EXIT.OK : EXIT.NOT_ALL_OK;
}
