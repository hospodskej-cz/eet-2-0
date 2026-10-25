import { createEetQueue, createMemoryStore, type EetQueue } from "@eet-gateway/queue";
import type { GatewayOptions, ServeOptions } from "@eet-gateway/server/serve";
import { DEFAULTS, type ScriptedTransport, scripted, T0 } from "../../queue/test/helpers.ts";
import type { CliIO } from "../src/context.ts";
import { run } from "../src/run.ts";

export interface FakeIO extends CliIO {
  out: string;
  err: string;
  readonly opened: GatewayOptions[];
  readonly served: ServeOptions[];
  closed: number;
  prompts: number;
}

export interface FakeOptions {
  files?: Record<string, string | Uint8Array>;
  stdin?: string;
  env?: Record<string, string>;
  interactive?: boolean;
  password?: string;
  transport?: ScriptedTransport;
  queue?: EetQueue;
  now?: Date;
  /** Thrown by openGateway, e.g. a ConfigError. */
  gatewayError?: Error;
}

/** A queue over memory, shared by every command of one fake session. */
export function fakeQueue(transport: ScriptedTransport = scripted(), withSecond = false) {
  const clock = { value: T0 };
  const queue = createEetQueue({
    store: createMemoryStore(),
    registers: {
      main: { transport, context: { register: DEFAULTS } },
      ...(withSecond
        ? { second: { transport, context: { register: { ...DEFAULTS, id_pokl: "P2" } } } }
        : {}),
    },
    now: () => clock.value,
    random: () => 0.5,
  });
  return { queue, clock, transport };
}

export function fakeIO(options: FakeOptions = {}): FakeIO {
  const bytes = (v: string | Uint8Array) =>
    typeof v === "string" ? new TextEncoder().encode(v) : v;
  const queue = options.queue ?? fakeQueue(options.transport).queue;
  const io: FakeIO = {
    out: "",
    err: "",
    opened: [],
    served: [],
    closed: 0,
    prompts: 0,
    stdout: (text) => {
      io.out += text;
    },
    stderr: (text) => {
      io.err += text;
    },
    readStdin: async () => bytes(options.stdin ?? ""),
    readFile: async (path) => {
      const content = options.files?.[path];
      if (content === undefined) throw new Error(`soubor ${path} neexistuje`);
      return bytes(content);
    },
    fileExists: async (path) => options.files?.[path] !== undefined,
    env: options.env ?? {},
    interactive: options.interactive ?? false,
    promptHidden: async () => {
      io.prompts += 1;
      return options.password ?? "";
    },
    openGateway: async (gatewayOptions) => {
      io.opened.push(gatewayOptions);
      if (options.gatewayError) throw options.gatewayError;
      return {
        queue,
        close: async () => {
          io.closed += 1;
        },
      };
    },
    serve: async (serveOptions) => {
      io.served.push(serveOptions);
      return 0;
    },
    now: () => options.now ?? new Date(T0),
  };
  return io;
}

export async function eet(io: FakeIO, ...argv: string[]) {
  io.out = "";
  io.err = "";
  const code = await run(argv, io);
  return { code, out: io.out, err: io.err };
}
