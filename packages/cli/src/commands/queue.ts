import { QueueError, SALE_STATUSES, type SaleResult, type SaleStatus } from "@eet-gateway/queue";
import { parse } from "../args.ts";
import { type CliIO, EXIT, type GatewayHandle, UsageError } from "../context.ts";
import { json, saleLines, summary } from "../output.ts";
import { cliLogger } from "./shared.ts";

export const QUEUE_HELP = `Použití:
  eet queue list [--status S1,S2] [--register ID] [--overdue] [--from T] [--to T] [--limit N] [--all]
  eet queue retry <id>
  eet queue flush [--register ID]

list   přehled fronty, od nejnovějších (from/to filtrují podle dat_trzby; --all všechny stránky)
retry  hned znovu pošle jednu tržbu (queued, uncertain, rejected)
flush  hned pošle všechno, co čeká na automatické doposlání, bez ohledu na backoff;
       rejected a nejisté tržby bez automatického opakování jen přes retry

Společné volby: --config cesta, --json, --verbose
Exit: 0 v pořádku, 3 retry/flush: něco nebylo přijato, 1 chyba, 2 špatné použití.
`;

export async function queue(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {
    status: { type: "string" },
    register: { type: "string" },
    overdue: { type: "boolean" },
    from: { type: "string" },
    to: { type: "string" },
    limit: { type: "string" },
    cursor: { type: "string" },
    all: { type: "boolean" },
  });
  const [action, ...rest] = positionals;
  if (values.help || action === undefined) {
    io.stdout(QUEUE_HELP);
    return values.help ? EXIT.OK : EXIT.USAGE;
  }
  if (!["list", "retry", "flush"].includes(action))
    throw new UsageError(`neznámá akce "${action}" (list, retry, flush)`);
  if (action === "retry" && rest.length !== 1) throw new UsageError("retry: uveď jedno id");
  if (action !== "retry" && rest.length > 0) throw new UsageError(`nečekaný argument "${rest[0]}"`);
  const status = values.status?.split(",").map((s) => s.trim()) as SaleStatus[] | undefined;
  const unknown = status?.find((s) => !(SALE_STATUSES as readonly string[]).includes(s));
  if (unknown !== undefined) throw new UsageError(`--status: neznámý stav "${unknown}"`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500))
    throw new UsageError("--limit: 1–500");

  const gateway = await io.openGateway({
    configPath: values.config,
    server: false,
    logger: cliLogger(io, values.verbose === true),
  });
  try {
    if (action === "list") {
      const filter = {
        status,
        register: values.register,
        overdue: values.overdue,
        from: values.from,
        to: values.to,
        limit,
        cursor: values.cursor,
      };
      let page = await list(gateway, filter);
      const items = [...page.items];
      while (values.all && page.nextCursor !== undefined) {
        page = await list(gateway, { ...filter, cursor: page.nextCursor });
        items.push(...page.items);
      }
      const nextCursor = values.all ? undefined : page.nextCursor;
      if (values.json) io.stdout(json(nextCursor ? { items, nextCursor } : { items }));
      else {
        io.stdout(table(items));
        if (nextCursor) io.stdout(`další stránka: --cursor ${nextCursor} (nebo --all)\n`);
      }
      return EXIT.OK;
    }

    if (action === "retry") {
      const result = await gateway.queue.retry(rest[0] as string);
      io.stdout(
        values.json ? json(result) : saleLines(result.id ?? "", result, values.verbose === true),
      );
      return settled(result) ? EXIT.OK : EXIT.NOT_ALL_OK;
    }

    // flush: everything with an automatic resend planned, sent now.
    const waiting: SaleResult[] = [];
    for (let cursor: string | undefined, more = true; more; ) {
      const page = await list(gateway, {
        status: ["queued", "uncertain"],
        register: values.register,
        limit: 500,
        cursor,
      });
      waiting.push(...page.items.filter((r) => r.nextAttemptAt !== undefined));
      cursor = page.nextCursor;
      more = cursor !== undefined;
    }
    const results: SaleResult[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const record of waiting.reverse()) {
      try {
        const result = await gateway.queue.retry(record.id as string);
        results.push(result);
        if (!values.json) io.stdout(saleLines(result.id ?? "", result, values.verbose === true));
      } catch (error) {
        if (!(error instanceof QueueError)) throw error;
        skipped.push({ id: record.id as string, reason: error.code });
        if (!values.json) io.stdout(`${record.id}  přeskočeno (${error.code})\n`);
      }
    }
    if (values.json) io.stdout(json({ results, skipped }));
    else io.stdout(summary(results.map((r) => r.status)));
    return results.every(settled) && skipped.length === 0 ? EXIT.OK : EXIT.NOT_ALL_OK;
  } catch (error) {
    if (error instanceof QueueError || error instanceof RangeError) {
      io.stderr(`${error.message}\n`);
      return EXIT.FAILURE;
    }
    throw error;
  } finally {
    await gateway.close();
  }
}

const settled = (result: SaleResult) =>
  result.status === "accepted" || result.status === "verification_ok";

function list(gateway: GatewayHandle, filter: Parameters<GatewayHandle["queue"]["list"]>[0]) {
  return gateway.queue.list(filter);
}

function table(items: readonly SaleResult[]): string {
  if (items.length === 0) return "Fronta je prázdná.\n";
  const rows = items.map((r) => [
    r.id ?? "",
    r.status,
    r.register ?? "",
    r.data?.porad_cis ?? "",
    r.data?.celk_trzba ?? "",
    r.data?.dat_trzby ?? "",
    String(r.attempts),
    r.overdue ? "po lhůtě" : (r.nextAttemptAt ?? ""),
  ]);
  const header = [
    "id",
    "stav",
    "pokladna",
    "porad_cis",
    "částka",
    "dat_trzby",
    "pokusy",
    "další pokus",
  ];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return `${[line(header), ...rows.map(line)].join("\n")}\n`;
}
