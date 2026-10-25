/**
 * Structured logs: one JSON object per line on stdout. Callers pass only fields they chose —
 * ids, codes, statuses, durations. Request bodies, `Authorization`, passwords, keys and
 * `SignatureValue` never reach a log line.
 */
import type { QueueEvent } from "@eet-gateway/queue";

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}

export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  return {
    log(level, message, fields = {}) {
      const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      write(JSON.stringify({ time: now().toISOString(), level, msg: message, ...defined }));
    },
  };
}

/** Queue events as log lines (they carry ids and codes only, see QueueEvent). */
export function logQueueEvent(logger: Logger, event: QueueEvent): void {
  switch (event.type) {
    case "attempt":
      logger.log("info", "attempt", {
        id: event.id,
        register: event.register,
        attempt: event.attempt,
        outcome: event.outcome,
        reason: event.reason,
        code: event.code,
        status: event.status,
        nextAttemptAt: event.nextAttemptAt,
      });
      return;
    case "needs_attention":
      logger.log("warn", "needs attention", {
        id: event.id,
        register: event.register,
        status: event.status,
        reason: event.reason,
        code: event.code,
        detail: event.message,
      });
      return;
    case "overdue":
      logger.log("warn", "overdue: no POK 48 h after the sale (ZoET §20)", {
        id: event.id,
        register: event.register,
        deadlineAt: event.deadlineAt,
        attempts: event.attempts,
      });
      return;
    case "error":
      logger.log("error", "queue error", { id: event.id, detail: event.message });
  }
}
