// Child process for crash.test.ts: queues one sale in a SQLite file and dies.
//   sync  — exits inside send(), i.e. after the write-ahead record (exit code 42)
//   async — exits after the sale is stored, before any attempt (exit code 43)
import { Database } from "bun:sqlite";
import { createEetQueue, createSqliteStore } from "../../src/index.ts";
import { DEFAULTS, input, scripted } from "../helpers.ts";

const [path, mode] = process.argv.slice(2);
const transport = scripted([() => process.exit(42)]);
const queue = createEetQueue({
  store: createSqliteStore(new Database(path)),
  registers: { main: { transport, context: { register: DEFAULTS } } },
});

if (mode === "sync") {
  await queue.submit(input("CRASH-SYNC"));
} else {
  await queue.stop(); // no background attempt before we die
  await queue.submit(input("CRASH-ASYNC"), { mode: "async" });
  process.exit(43);
}
