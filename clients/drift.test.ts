// The clients in clients/ must cover docs/openapi.json (scripts/gen-clients.ts). Runs with the
// repository's `bun test`, so a PR that changes the API without the clients fails the main CI too.
import { describe, expect, test } from "bun:test";
import { checkClients, loadSpec, type OpenApi, specOperations } from "../scripts/gen-clients.ts";

describe("clients/ vs docs/openapi.json", () => {
  const spec = loadSpec();

  test("every client covers every operation, parameter and property", () => {
    expect(checkClients(spec)).toEqual([]);
  });

  test("the document has operations to cover", () => {
    expect(specOperations(spec).map((o) => o.id)).toContain("submitSale");
  });

  test("a new operation is reported for every client", () => {
    const extended: OpenApi = {
      ...spec,
      paths: {
        ...spec.paths,
        "/v1/refunds": { post: { operationId: "createRefund" } },
      },
    };
    const problems = checkClients(extended);
    expect(problems.filter((p) => p.includes("createRefund"))).toHaveLength(3);
  });

  test("a new query parameter is reported", () => {
    const first = Object.entries(spec.paths)[0];
    if (!first) throw new Error("no paths");
    const [path, item] = first;
    const [method, operation] = Object.entries(item)[0] ?? [];
    if (!method || !operation) throw new Error("no operation");
    const changed: OpenApi = {
      ...spec,
      paths: {
        ...spec.paths,
        [path]: {
          ...item,
          [method]: {
            ...operation,
            parameters: [...(operation.parameters ?? []), { name: "taxCode", in: "query" }],
          },
        },
      },
    };
    expect(checkClients(changed).filter((p) => p.includes('"taxCode"'))).toHaveLength(3);
  });

  test("a new response property is reported", () => {
    const changed: OpenApi = {
      ...spec,
      components: { schemas: { Extra: { properties: { cashbackAmount: { type: "string" } } } } },
    };
    expect(checkClients(changed).filter((p) => p.includes('"cashbackAmount"'))).toHaveLength(3);
  });
});
