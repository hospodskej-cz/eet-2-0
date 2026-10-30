// Drift guard for the thin hand-written API clients in clients/ (PHP, Python, C#, Java).
//
// The clients are not generated (see clients/README.md for why), so something has to notice when
// docs/openapi.json gains an operation, a query parameter, a header or a response field that a
// client does not know yet. This script reads the OpenAPI document and checks every client source:
//
//   1. the operation table of each client (operationId -> method, path) equals the document's;
//   2. every query and header parameter name occurs as a string literal in the client;
//   3. every response/request property name occurs as a string literal in the client's models;
//   4. every SaleResult status occurs as a string literal.
//
// The clients' own test suites (clients/*/tests) check the same against a fake server at run time.
//
//   bun scripts/gen-clients.ts            check, exit 1 on drift (CI: .github/workflows/clients.yml)
//   bun scripts/gen-clients.ts --list     print the operation x client matrix
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface Parameter {
  readonly name: string;
  readonly in: string;
}
interface Operation {
  readonly operationId: string;
  readonly parameters?: readonly Parameter[];
}
export interface OpenApi {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components?: { readonly schemas?: unknown };
}

export interface SpecOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly parameters: readonly string[];
}

interface Client {
  readonly name: string;
  /** Directory of the client's library sources, relative to the repository root. */
  readonly src: string;
  readonly extension: string;
  /** The file holding the operation table. */
  readonly operations: string;
}

export const CLIENTS: readonly Client[] = [
  {
    name: "python",
    src: "clients/python/src/eet_gateway_client",
    extension: ".py",
    operations: "client.py",
  },
  { name: "php", src: "clients/php/src", extension: ".php", operations: "Operations.php" },
  {
    name: "dotnet",
    src: "clients/dotnet/src/EetGateway.Client",
    extension: ".cs",
    operations: "EetGatewayClient.cs",
  },
  {
    name: "java",
    src: "clients/java/src/main/java/cz/hospodskej/eetgateway",
    extension: ".java",
    operations: "EetGatewayClient.java",
  },
];

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** Every operation of the document, with its query and header parameter names. */
export function specOperations(spec: OpenApi): SpecOperation[] {
  const found: SpecOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      found.push({
        id: operation.operationId,
        method: method.toUpperCase(),
        path,
        parameters: (operation.parameters ?? [])
          .filter((p) => p.in === "query" || p.in === "header")
          .map((p) => p.name),
      });
    }
  }
  return found;
}

/** Names under every `properties` key of the component schemas. */
export function schemaProperties(schemas: unknown): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "properties" && typeof value === "object" && value !== null) {
          for (const name of Object.keys(value)) names.add(name);
        }
        visit(value);
      }
    }
  };
  visit(schemas);
  return names;
}

function statuses(schemas: unknown): string[] {
  const status = (
    schemas as {
      SaleResult?: { properties?: { status?: { enum?: string[] } } };
    }
  ).SaleResult?.properties?.status;
  return status?.enum ?? [];
}

/**
 * Matches `"id": ("POST", "/v1/x")`, `'id' => ['POST', '/v1/x']`, `["id"] = ("POST", "/v1/x")` and
 * `op("id", "POST", "/v1/x")`.
 */
const TABLE_ENTRY =
  /["'](\w+)["']\]?\s*(?:=>|=|:|,)\s*[([]?\s*["']([A-Z]+)["']\s*,\s*["'](\/[^"']*)["']/g;

function readSources(root: string, client: Client): string {
  const dir = join(root, client.src);
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(client.extension))
    .map((entry) => join(entry.parentPath, entry.name));
  if (files.length === 0) throw new Error(`no ${client.extension} sources in ${client.src}`);
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

function hasLiteral(source: string, name: string): boolean {
  return source.includes(`"${name}"`) || source.includes(`'${name}'`);
}

/** Problems found in the clients under `root`; empty when they cover the document. */
export function checkClients(spec: OpenApi, root: string = ROOT): string[] {
  const problems: string[] = [];
  const operations = specOperations(spec);
  const schemas = spec.components?.schemas ?? {};
  const properties = [...schemaProperties(schemas)].sort();
  const parameters = [...new Set(operations.flatMap((o) => o.parameters))].sort();

  for (const client of CLIENTS) {
    const tag = `[${client.name}]`;
    let sources: string;
    let table: string;
    try {
      sources = readSources(root, client);
      table = readFileSync(join(root, client.src, client.operations), "utf8");
    } catch (error) {
      problems.push(`${tag} ${(error as Error).message}`);
      continue;
    }

    const implemented = new Map<string, string>();
    for (const [, id, method, path] of table.matchAll(TABLE_ENTRY)) {
      if (id && method && path) implemented.set(id, `${method} ${path}`);
    }
    for (const operation of operations) {
      const want = `${operation.method} ${operation.path}`;
      const have = implemented.get(operation.id);
      if (have === undefined) {
        problems.push(
          `${tag} operation ${operation.id} (${want}) is missing from ${client.operations}`,
        );
      } else if (have !== want) {
        problems.push(
          `${tag} operation ${operation.id} is "${have}" in ${client.operations}, the spec says "${want}"`,
        );
      }
    }
    const known = new Set(operations.map((o) => o.id));
    for (const id of implemented.keys()) {
      if (!known.has(id))
        problems.push(`${tag} operation ${id} is in ${client.operations} but not in openapi.json`);
    }

    for (const name of parameters) {
      if (!hasLiteral(sources, name))
        problems.push(`${tag} query/header parameter "${name}" is not handled`);
    }
    for (const name of properties) {
      if (!hasLiteral(sources, name)) problems.push(`${tag} schema property "${name}" is not read`);
    }
    for (const status of statuses(schemas)) {
      if (!hasLiteral(sources, status))
        problems.push(`${tag} SaleResult status "${status}" is unknown`);
    }
  }
  return problems;
}

export function loadSpec(root: string = ROOT): OpenApi {
  return JSON.parse(readFileSync(join(root, "docs", "openapi.json"), "utf8")) as OpenApi;
}

/** operationId -> clients that implement it, for `--list`. */
function matrix(spec: OpenApi): string {
  const rows = specOperations(spec).map((operation) => {
    const marks = CLIENTS.map((client) => {
      const table = readFileSync(join(ROOT, client.src, client.operations), "utf8");
      const ids = [...table.matchAll(TABLE_ENTRY)].map((m) => m[1]);
      return ids.includes(operation.id) ? "yes" : "NO";
    });
    return `${operation.id.padEnd(18)}${`${operation.method} ${operation.path}`.padEnd(30)}${marks.map((m) => m.padEnd(8)).join("")}`;
  });
  const header = `${"operationId".padEnd(18)}${"".padEnd(30)}${CLIENTS.map((c) => c.name.padEnd(8)).join("")}`;
  return [header, ...rows].join("\n");
}

if (import.meta.main) {
  const spec = loadSpec();
  if (process.argv.includes("--list")) {
    console.log(matrix(spec));
  } else {
    const problems = checkClients(spec);
    if (problems.length > 0) {
      console.error(
        `The clients in clients/ have drifted from docs/openapi.json (${problems.length}):`,
      );
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error("Update the clients (library and test tables) to match docs/openapi.json.");
      process.exit(1);
    }
    const count = specOperations(spec).length;
    console.log(`ok: ${CLIENTS.length} clients cover all ${count} operations of docs/openapi.json`);
  }
}
