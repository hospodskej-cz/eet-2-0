/**
 * Retry policy (docs/ADR-003-queue-retry-policy.md): what an attempt's outcome means for the
 * sale and whether and when to try again. Pure functions; the table in the ADR is the spec.
 */
import type { SaleStatus } from "./result.ts";
import type { AttemptOutcome } from "./store.ts";

export interface RetryPolicy {
  /**
   * Resend automatically when an attempt may have reached EET but brought no answer. Default
   * `true`: metodika 1.3 asks for the same resend whether or not EET got the message, and a
   * resend of the same sale is not a second sale (rozhraní §4). See ADR-003.
   */
  readonly retryUncertain: boolean;
  /** Delay after the first failed attempt. */
  readonly initialDelayMs: number;
  /** Upper bound of the doubling delay. */
  readonly maxDelayMs: number;
  /** Error 8 is ambiguous (technical or data error): rejections with it before giving up. */
  readonly code8Attempts: number;
  /** ± fraction of random spread, so queued sales do not resend in lockstep. */
  readonly jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retryUncertain: true,
  initialDelayMs: 5_000,
  maxDelayMs: 300_000,
  code8Attempts: 3,
  jitter: 0.2,
};

export interface OutcomeSummary {
  readonly kind: AttemptOutcome;
  readonly reason?: string | undefined;
  readonly code?: number | undefined;
}

export interface DecisionContext {
  /** Number of the attempt that just ended (1-based). */
  readonly attempt: number;
  /** Status before this attempt. */
  readonly previousStatus: SaleStatus;
  /** Rejections with error 8 so far, this attempt included. */
  readonly code8Rejections: number;
}

export interface Decision {
  readonly status: SaleStatus;
  /** Delay until the next automatic attempt; undefined means none. */
  readonly retryInMs?: number | undefined;
  /** A person has to look at the record: it will not succeed on its own. */
  readonly attention: boolean;
}

/** Reasons that point at a forged or misconfigured endpoint; resending cannot help. */
const NEVER_RETRY_UNCERTAIN = new Set(["signature", "environment_mismatch"]);

/** Doubling delay from `initialDelayMs`, capped at `maxDelayMs`, with random spread. */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.round(base * (1 + policy.jitter * (2 * random() - 1))));
}

export function decide(
  outcome: OutcomeSummary,
  context: DecisionContext,
  policy: RetryPolicy,
  random: () => number = Math.random,
): Decision {
  const retry = () => backoffDelay(context.attempt, policy, random);
  // Once an attempt may have reached EET, only an EET answer can settle that.
  const pending: SaleStatus = context.previousStatus === "uncertain" ? "uncertain" : "queued";

  switch (outcome.kind) {
    case "accepted":
    case "verification_ok":
      return { status: outcome.kind, attention: false };
    case "rejected": {
      const code = outcome.code ?? 0;
      if (code < 0) return { status: pending, retryInMs: retry(), attention: false };
      if (code === 8 && context.code8Rejections < policy.code8Attempts)
        return { status: pending, retryInMs: retry(), attention: false };
      return { status: "rejected", attention: true };
    }
    case "not_sent":
      if (outcome.reason === "too_large") return { status: "invalid", attention: true };
      return { status: pending, retryInMs: retry(), attention: false };
    case "uncertain":
    case "interrupted":
      if (NEVER_RETRY_UNCERTAIN.has(outcome.reason ?? "") || !policy.retryUncertain)
        return { status: "uncertain", attention: true };
      return { status: "uncertain", retryInMs: retry(), attention: false };
  }
}
