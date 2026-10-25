/**
 * What a command needs from the outside world. `main.ts` wires the real process; tests pass
 * their own, so every command runs in-process with a fake gateway.
 */
import type { EetQueue } from "@eet-gateway/queue";
import type { GatewayOptions, ServeOptions } from "@eet-gateway/server/serve";

export const EXIT = {
  OK: 0,
  /** Configuration, certificate, I/O or other failure. */
  FAILURE: 1,
  /** Wrong command line. */
  USAGE: 2,
  /** Ran fine, but a sale was not accepted (send) or not valid (validate). */
  NOT_ALL_OK: 3,
} as const;

export interface GatewayHandle {
  readonly queue: EetQueue;
  close(): Promise<void>;
}

export interface CliIO {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readStdin: () => Promise<Uint8Array>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly fileExists: (path: string) => Promise<boolean>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** stdin is an interactive terminal (a password may be asked for). */
  readonly interactive: boolean;
  readonly promptHidden: (question: string) => Promise<string>;
  readonly openGateway: (options: GatewayOptions) => Promise<GatewayHandle>;
  /** Runs the HTTP service until a signal; resolves with the exit code. */
  readonly serve: (options: ServeOptions) => Promise<number>;
  readonly now: () => Date;
}

/** Usage problem: printed with a hint to `--help`, exit code 2. */
export class UsageError extends Error {
  override readonly name = "UsageError";
}
