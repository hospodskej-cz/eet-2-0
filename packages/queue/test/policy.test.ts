import { describe, expect, test } from "bun:test";
import {
  backoffDelay,
  DEFAULT_RETRY_POLICY,
  type DecisionContext,
  decide,
  type OutcomeSummary,
  type RetryPolicy,
  type SaleStatus,
} from "../src/index.ts";

const MIDDLE = () => 0.5; // no jitter
const FIRST: DecisionContext = { attempt: 1, previousStatus: "queued", code8Rejections: 0 };

describe("decide — the ADR-003 table", () => {
  const rows: [OutcomeSummary, Partial<DecisionContext>, SaleStatus, boolean, boolean][] = [
    // outcome, context, status, retried automatically, needs attention
    [{ kind: "accepted" }, {}, "accepted", false, false],
    [{ kind: "verification_ok" }, {}, "verification_ok", false, false],
    [{ kind: "rejected", code: -1 }, {}, "queued", true, false],
    [{ kind: "rejected", code: -999 }, {}, "queued", true, false],
    [{ kind: "rejected", code: 8 }, { code8Rejections: 1 }, "queued", true, false],
    [{ kind: "rejected", code: 8 }, { code8Rejections: 2 }, "queued", true, false],
    [{ kind: "rejected", code: 8 }, { code8Rejections: 3 }, "rejected", false, true],
    [{ kind: "rejected", code: 3 }, {}, "rejected", false, true],
    [{ kind: "rejected", code: 4 }, {}, "rejected", false, true],
    [{ kind: "rejected", code: 9 }, {}, "rejected", false, true],
    [{ kind: "not_sent", reason: "network" }, {}, "queued", true, false],
    [{ kind: "not_sent", reason: "signer" }, {}, "queued", true, false],
    [{ kind: "not_sent", reason: "aborted" }, {}, "queued", true, false],
    [{ kind: "not_sent", reason: "too_large" }, {}, "invalid", false, true],
    [{ kind: "uncertain", reason: "timeout" }, {}, "uncertain", true, false],
    [{ kind: "uncertain", reason: "network" }, {}, "uncertain", true, false],
    [{ kind: "uncertain", reason: "http" }, {}, "uncertain", true, false],
    [{ kind: "uncertain", reason: "soap_fault" }, {}, "uncertain", true, false],
    [{ kind: "uncertain", reason: "malformed_response" }, {}, "uncertain", true, false],
    [{ kind: "interrupted", reason: "interrupted" }, {}, "uncertain", true, false],
    [{ kind: "uncertain", reason: "signature" }, {}, "uncertain", false, true],
    [{ kind: "uncertain", reason: "environment_mismatch" }, {}, "uncertain", false, true],
    // An earlier attempt may have reached EET: only an EET answer settles it.
    [
      { kind: "not_sent", reason: "network" },
      { previousStatus: "uncertain" },
      "uncertain",
      true,
      false,
    ],
    [{ kind: "rejected", code: -1 }, { previousStatus: "uncertain" }, "uncertain", true, false],
    [{ kind: "accepted" }, { previousStatus: "uncertain" }, "accepted", false, false],
    [{ kind: "rejected", code: 4 }, { previousStatus: "uncertain" }, "rejected", false, true],
    // A manual retry of a rejected sale that cannot connect is simply queued.
    [
      { kind: "not_sent", reason: "network" },
      { previousStatus: "rejected" },
      "queued",
      true,
      false,
    ],
  ];
  for (const [outcome, context, status, retried, attention] of rows) {
    const label = `${outcome.kind}${outcome.reason ? `/${outcome.reason}` : ""}${outcome.code === undefined ? "" : ` ${outcome.code}`}`;
    test(`${label} after ${context.previousStatus ?? "queued"} → ${status}`, () => {
      const decision = decide(outcome, { ...FIRST, ...context }, DEFAULT_RETRY_POLICY, MIDDLE);
      expect(decision.status).toBe(status);
      expect(decision.retryInMs !== undefined).toBe(retried);
      expect(decision.attention).toBe(attention);
    });
  }

  test("retryUncertain=false leaves uncertain sales to a person", () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, retryUncertain: false };
    for (const kind of ["uncertain", "interrupted"] as const) {
      expect(decide({ kind, reason: "timeout" }, FIRST, policy, MIDDLE)).toEqual({
        status: "uncertain",
        attention: true,
      });
    }
    // Nothing reached EET: still resent.
    expect(decide({ kind: "not_sent", reason: "network" }, FIRST, policy, MIDDLE).retryInMs).toBe(
      5_000,
    );
  });
});

describe("backoffDelay", () => {
  test("doubles from 5 s and stops at 5 min", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) =>
      backoffDelay(n, DEFAULT_RETRY_POLICY, MIDDLE),
    );
    expect(delays).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
  });

  test("spreads ±20 %", () => {
    expect(backoffDelay(1, DEFAULT_RETRY_POLICY, () => 0)).toBe(4_000);
    expect(backoffDelay(1, DEFAULT_RETRY_POLICY, () => 0.999_999)).toBe(6_000);
  });
});
