/**
 * Human-readable output: one line per sale, indented details, a summary. With `--json` the
 * commands print the library's result objects instead (stable, see docs/CLI.md).
 */
import type { SaleIssue, SaleResult, SaleWarning, ValidationResult } from "@eet-gateway/queue";

const STATUS_WIDTH = 16;

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sale(data: SaleResult["data"]): string {
  if (data === undefined) return "";
  return `${data.porad_cis} · ${data.celk_trzba} · ${data.dat_trzby} · ${data.id_pokl}`;
}

function detail(result: SaleResult): string {
  switch (result.status) {
    case "accepted":
      return `POK ${result.pok}${result.test ? " (playground)" : ""}`;
    case "verification_ok":
      return "ověřeno, nic se neevidovalo";
    case "rejected":
      return `EET ${result.code}: ${result.message ?? ""}`;
    case "queued":
      return `ve frontě${result.reason ? ` (${result.reason})` : ""}${next(result)}`;
    case "uncertain":
      return `nejisté (${result.reason ?? "?"})${result.nextAttemptAt ? next(result) : ", čeká na ruční rozhodnutí"}`;
    case "invalid":
      return "nic se neodeslalo";
  }
}

const next = (result: SaleResult) =>
  result.nextAttemptAt ? `, další pokus ${result.nextAttemptAt}` : "";

/** Warnings EET returned or the queue raised are always shown; ingest ones with `verbose`. */
function details(
  issues: readonly SaleIssue[],
  warnings: readonly SaleWarning[],
  verbose: boolean,
): string[] {
  const lines = issues.map(
    (i) => `    chyba ${i.code}${i.field ? ` (${i.field})` : ""}: ${i.message}`,
  );
  const shown = verbose ? warnings : warnings.filter((w) => w.source !== "ingest");
  lines.push(...shown.map((w) => `    varování ${w.code} [${w.source}]: ${w.message}`));
  const hidden = warnings.length - shown.length;
  if (hidden > 0) lines.push(`    (${hidden}× úprava vstupu, vypíše --verbose)`);
  return lines;
}

export function saleLines(label: string, result: SaleResult, verbose: boolean): string {
  const head = [label, result.status.padEnd(STATUS_WIDTH), detail(result), sale(result.data)]
    .filter((part) => part !== "")
    .join("  ")
    .trimEnd();
  const body = details(result.issues ?? [], result.warnings, verbose);
  const id = result.id !== undefined && result.status !== "accepted" ? [`    id ${result.id}`] : [];
  return `${[head, ...id, ...body].join("\n")}\n`;
}

export function validationLines(label: string, result: ValidationResult, verbose: boolean): string {
  const data = result.data;
  const head = [
    label,
    (result.valid ? "platná" : "neplatná").padEnd(STATUS_WIDTH),
    result.register ? `pokladna ${result.register}` : "",
    data ? `${data.porad_cis} · ${data.celk_trzba} · ${data.dat_trzby}` : "",
  ]
    .filter((part) => part !== "")
    .join("  ")
    .trimEnd();
  return `${[head, ...details(result.issues, result.warnings, verbose)].join("\n")}\n`;
}

export function summary(statuses: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  const parts = [...counts].map(([status, count]) => `${count}× ${status}`);
  return `Celkem ${statuses.length}: ${parts.join(", ") || "nic"}\n`;
}

export function sourceProblems(
  issues: readonly SaleIssue[],
  warnings: readonly SaleWarning[],
): string {
  const lines = [
    ...issues.map((i) => `Zdroj nejde přečíst: ${i.message}`),
    ...warnings.map((w) => `varování ${w.code}: ${w.message}`),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
