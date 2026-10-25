// Writes docs/openapi.json from the server's route table and zod schemas.
// Run after changing the API: bun run gen:openapi (a test fails while the file is stale).
import { fileURLToPath } from "node:url";
import { buildOpenApi, VERSION } from "../packages/server/src/index.ts";

const target = fileURLToPath(new URL("../docs/openapi.json", import.meta.url));
await Bun.write(target, `${JSON.stringify(buildOpenApi(VERSION), null, 2)}\n`);
console.log(`wrote ${target}`);
