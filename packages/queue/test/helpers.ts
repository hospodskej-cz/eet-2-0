import type {
  EetTransport,
  NotSentReason,
  TransportOutcome,
  TransportRequest,
  UncertainReason,
} from "@eet-gateway/core";
import {
  createEetQueue,
  createMemoryStore,
  type EetQueueOptions,
  type QueueEvent,
  type QueueStore,
} from "../src/index.ts";

export const T0 = Date.parse("2026-10-25T18:00:00+01:00");
export const ENDPOINT = "https://pg.example/eet/services/EETServiceSOAP/v4";
export const DEFAULTS = { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "P1" };

/** A sale as a POS would send it, register defaults filling the rest. */
export function input(porad = "U-1", extra: Record<string, unknown> = {}) {
  return {
    porad_cis: porad,
    dat_trzby: "2026-10-25T18:00:00+01:00",
    celk_trzba: "100.00",
    ...extra,
  };
}

type Step = (request: TransportRequest) => TransportOutcome | Promise<TransportOutcome>;

const meta = { durationMs: 7, httpStatus: 200, globalTransactionId: "gtid-1" };

export const accepted: Step = (request) => ({
  kind: "accepted",
  pok: `${request.header.uuid_zpravy}-ff`,
  uuid_zpravy: request.header.uuid_zpravy,
  dat_prij: request.header.dat_odesl,
  test: true,
  warnings: [],
  meta,
});

export const verificationOk: Step = () => ({
  kind: "verification_ok",
  test: true,
  warnings: [],
  meta,
});

export const rejected =
  (code: number, message = `chyba ${code}`): Step =>
  (request) => ({
    kind: "rejected",
    code,
    message,
    uuid_zpravy: request.header.uuid_zpravy,
    test: true,
    warnings: [],
    meta,
  });

export const notSent =
  (reason: NotSentReason = "network"): Step =>
  () => ({ kind: "not_sent", reason, message: `not sent: ${reason}`, meta: { durationMs: 1 } });

export const uncertain =
  (reason: UncertainReason = "timeout"): Step =>
  () => ({ kind: "uncertain", reason, message: `uncertain: ${reason}`, meta: { durationMs: 10 } });

export interface ScriptedTransport extends EetTransport {
  readonly requests: TransportRequest[];
  /** Outcomes for the next calls, in order; afterwards `fallback`. */
  readonly script: Step[];
  fallback: Step;
}

export function scripted(script: Step[] = [], endpoint = ENDPOINT): ScriptedTransport {
  const transport: ScriptedTransport = {
    environment: "playground",
    endpoint,
    requests: [],
    script: [...script],
    fallback: accepted,
    async send(request) {
      transport.requests.push(structuredClone(request));
      const step = transport.script.shift() ?? transport.fallback;
      return step(request);
    },
  };
  return transport;
}

/** A step that blocks until `release()` is called — an attempt in flight. */
export function blocking(): { step: Step; release: (outcome?: Step) => void } {
  let resolve: (step: Step) => void = () => {};
  const gate = new Promise<Step>((r) => {
    resolve = r;
  });
  return {
    step: async (request) => (await gate)(request),
    release: (outcome = accepted) => resolve(outcome),
  };
}

export class Clock {
  constructor(public value = T0) {}
  readonly now = () => this.value;
  advance(ms: number) {
    this.value += ms;
  }
}

export function setup(
  overrides: Partial<EetQueueOptions> & { transport?: ScriptedTransport; store?: QueueStore } = {},
) {
  const clock = new Clock();
  const transport = overrides.transport ?? scripted();
  const store = overrides.store ?? createMemoryStore();
  const events: QueueEvent[] = [];
  const queue = createEetQueue({
    store,
    registers: { main: { transport, context: { register: DEFAULTS } } },
    now: clock.now,
    random: () => 0.5,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { queue, transport, store, clock, events };
}
