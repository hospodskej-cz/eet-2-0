/**
 * `createEetQueue` — every sale is stored before it is sent, resent by the ADR-003 policy and
 * never sent as a first submission twice. One attempt = write-ahead record → one
 * `EetTransport.send()` → outcome stored. Contract for integrators: docs/QUEUE.md.
 */
import {
  createHeader,
  type EetReceiptData,
  type EetTransport,
  saleKey,
  type TransportOutcome,
} from "@eet-gateway/core";
import {
  type BatchFormat,
  DATA_FIELDS,
  type IngestContext,
  type IngestWarning,
  inputRegister,
  type NormalizedSale,
  normalizeSale,
  readSales,
} from "@eet-gateway/ingest";
import { QueueError, QueueWarningCode } from "./codes.ts";
import { backoffDelay, DEFAULT_RETRY_POLICY, decide, type RetryPolicy } from "./policy.ts";
import {
  invalidResult,
  isOverdue,
  recordResult,
  type SaleIssue,
  type SaleResult,
  type SaleStatus,
  type SaleWarning,
  type ValidationResult,
} from "./result.ts";
import {
  type AttemptOutcome,
  type AttemptRecord,
  type QueueStore,
  type SaleRecord,
  type SaleState,
  stateOf,
  withState,
} from "./store.ts";

/** ZoET §20: resend at the latest 48 hours after the sale. */
const DEADLINE_MS = 48 * 3_600_000;
const FINAL: ReadonlySet<SaleStatus> = new Set(["accepted", "verification_ok", "invalid"]);

export interface RegisterConfig {
  /** Signs and sends with this register's certificate; looked up again for every attempt. */
  readonly transport: EetTransport;
  /** Ingest settings: defaults for `eic_popl`/`id_jednotky`/`id_pokl`, time zone, field map. */
  readonly context?: Omit<IngestContext, "now"> | undefined;
}

export interface EetQueueOptions {
  readonly store: QueueStore;
  readonly registers: Readonly<Record<string, RegisterConfig>>;
  /** Default `true`, see `RetryPolicy.retryUncertain` and ADR-003. */
  readonly retryUncertain?: boolean | undefined;
  readonly retry?:
    | { readonly [K in keyof Omit<RetryPolicy, "retryUncertain">]?: number | undefined }
    | undefined;
  /** Attempts the worker runs at once. Default 4. */
  readonly concurrency?: number | undefined;
  /**
   * How long an attempt may hold a record. Must exceed twice the transport's `timeoutMs`: an
   * attempt is aborted after `leaseMs / 2`, and a lease that runs out marks the attempt
   * `interrupted`. Default 120 000.
   */
  readonly leaseMs?: number | undefined;
  /** How often a started worker looks for due resends. Default 5 000. */
  readonly pollIntervalMs?: number | undefined;
  /** Progress and problems, for logs and alerts. Events carry ids and codes, never keys. */
  readonly onEvent?: ((event: QueueEvent) => void) | undefined;
  readonly now?: (() => number) | undefined;
  readonly random?: (() => number) | undefined;
}

export interface SubmitOptions {
  /** Register id; may also come from the input field `register`. Optional with one register. */
  readonly register?: string | undefined;
  /**
   * `sync` (default) waits for the first attempt; `async` stores the sale, returns `queued` and
   * sends it in the background right away (metodika 1.2: no deliberate batching).
   */
  readonly mode?: "sync" | "async" | undefined;
  /** Verification mode (`overeni`): EET checks the message and registers nothing. */
  readonly verify?: boolean | undefined;
  /** Same key + same sale → the stored result; same key + another sale → `invalid`. */
  readonly idempotencyKey?: string | undefined;
}

export interface BatchValidationResult {
  readonly rows: { readonly row: number; readonly result: ValidationResult }[];
  readonly warnings: SaleWarning[];
  readonly issues: SaleIssue[];
}

export interface BatchSubmitResult {
  readonly rows: { readonly row: number; readonly result: SaleResult }[];
  /** About the whole source, e.g. CP1250 decoding. */
  readonly warnings: SaleWarning[];
  /** Non-empty when the source could not be read at all. */
  readonly issues: SaleIssue[];
}

export interface ListOptions {
  readonly status?: SaleStatus | readonly SaleStatus[] | undefined;
  readonly register?: string | undefined;
  /** `dat_trzby` from (inclusive). */
  readonly from?: Date | string | undefined;
  /** `dat_trzby` to (exclusive). */
  readonly to?: Date | string | undefined;
  readonly overdue?: boolean | undefined;
  /** Default 50, at most 500. */
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export type QueueEvent =
  | {
      readonly type: "attempt";
      readonly id: string;
      readonly register: string;
      readonly attempt: number;
      readonly outcome: AttemptOutcome;
      readonly reason?: string | undefined;
      readonly code?: number | undefined;
      readonly status: SaleStatus;
      readonly nextAttemptAt?: string | undefined;
    }
  | {
      /** The record will not succeed on its own: rejected, untrusted answer, or no auto-retry. */
      readonly type: "needs_attention";
      readonly id: string;
      readonly register: string;
      readonly status: SaleStatus;
      readonly reason?: string | undefined;
      readonly code?: number | undefined;
      readonly message?: string | undefined;
    }
  | {
      /** An attempt failed more than 48 hours after the sale (ZoET §20). */
      readonly type: "overdue";
      readonly id: string;
      readonly register: string;
      readonly deadlineAt: string;
      readonly attempts: number;
    }
  | { readonly type: "error"; readonly id?: string | undefined; readonly message: string };

export interface EetQueue {
  /** Validates (ingest), stores, then sends one sale. Never throws for bad input: `invalid`. */
  submit(input: unknown, options?: SubmitOptions): Promise<SaleResult>;
  /**
   * Every row is submitted on its own; a row may name its register (`options.register` is the
   * default). Idempotency keys become `${key}:${row}`.
   */
  submitBatch(
    source: string | Uint8Array,
    format: BatchFormat,
    options?: SubmitOptions,
  ): Promise<BatchSubmitResult>;
  /** Ingest and register choice exactly as `submitBatch` does; nothing is stored or sent. */
  validateBatch(
    source: string | Uint8Array,
    format: BatchFormat,
    options?: Pick<SubmitOptions, "register" | "verify">,
  ): BatchValidationResult;
  get(id: string): Promise<SaleResult | undefined>;
  attempts(id: string): Promise<AttemptRecord[]>;
  /** Sends a stored sale again now (never with `prvni_zaslani=true` after a first attempt). */
  retry(id: string): Promise<SaleResult>;
  list(options?: ListOptions): Promise<{ items: SaleResult[]; nextCursor?: string | undefined }>;
  /** Sends everything that is due and waits until it is done; for own schedulers and tests. */
  runDue(): Promise<void>;
  /** Starts resending in the background every `pollIntervalMs`. */
  start(): void;
  /** Stops the worker and waits for running attempts. */
  stop(): Promise<void>;
}

type Outcome =
  | TransportOutcome
  | { readonly kind: "uncertain"; readonly reason: "transport_error"; readonly message: string };

export function createEetQueue(options: EetQueueOptions): EetQueue {
  const { store, registers } = options;
  const policy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    // Unset fields keep their defaults.
    ...Object.fromEntries(Object.entries(options.retry ?? {}).filter(([, v]) => v !== undefined)),
    retryUncertain: options.retryUncertain ?? DEFAULT_RETRY_POLICY.retryUncertain,
  };
  const concurrency = options.concurrency ?? 4;
  const leaseMs = options.leaseMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  validate(policy, concurrency, leaseMs, pollIntervalMs);
  const clock = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const registerIds = Object.keys(registers);
  const registerOf = (id: string) => (Object.hasOwn(registers, id) ? registers[id] : undefined);

  const emit = (event: QueueEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // A failing listener must not break sending.
    }
  };

  /**
   * Endpoints whose last attempt could not connect (ADR-003, endpoint gate): resends wait for a
   * single probe at `probeAt`, which backs off like a sale does.
   */
  const gates = new Map<string, { failures: number; probeAt: number }>();
  /** Endpoints with a probe attempt running. */
  const probing = new Set<string>();
  /** Attempts running in this process, by sale id. */
  const inflight = new Map<string, Promise<SaleResult>>();
  /** Worker attempts (background), for `concurrency`. */
  const running = new Set<Promise<unknown>>();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking: Promise<void> | undefined;
  let again = false;

  function contextFor(register: RegisterConfig): IngestContext {
    return {
      ...register.context,
      environment: register.context?.environment ?? register.transport.environment,
      now: () => new Date(clock()),
    };
  }

  function pickRegister(
    named: string | undefined,
  ): { id: string; config: RegisterConfig } | SaleIssue {
    const id = named ?? (registerIds.length === 1 ? registerIds[0] : undefined);
    if (id === undefined) {
      return {
        code: "unknown_register",
        message: `Pokladna není určena; nakonfigurované jsou: ${registerIds.join(", ") || "žádné"}.`,
        field: "register",
      };
    }
    const config = registerOf(id);
    if (config === undefined) {
      return {
        code: "unknown_register",
        message: `Pokladna "${id}" není nakonfigurovaná.`,
        field: "register",
      };
    }
    return { id, config };
  }

  /** Register choice and ingest for one input; shared by submit, batches and validation. */
  function prepare(
    input: unknown,
    named: string | undefined,
    readWarnings: readonly IngestWarning[] = [],
  ):
    | { ok: true; register: string; sale: NormalizedSale; warnings: IngestWarning[] }
    | { ok: false; issues: SaleIssue[]; warnings: SaleWarning[] } {
    const picked = pickRegister(named ?? inputRegister(input));
    if ("code" in picked) return { ok: false, issues: [picked], warnings: [...readWarnings] };
    const ingested = normalizeSale(input, contextFor(picked.config));
    const warnings = [...readWarnings, ...ingested.warnings];
    if (!ingested.ok) return { ok: false, issues: ingested.issues, warnings };
    const conflict = registerConflict(ingested.sale, picked.id);
    if (conflict !== undefined) return { ok: false, issues: [conflict], warnings };
    return { ok: true, register: picked.id, sale: ingested.sale, warnings };
  }

  function track(id: string, run: () => Promise<SaleResult>): Promise<SaleResult> {
    const promise = run().finally(() => inflight.delete(id));
    inflight.set(id, promise);
    return promise;
  }

  async function enqueue(
    register: string,
    sale: NormalizedSale,
    warnings: readonly IngestWarning[],
    submit: SubmitOptions,
  ): Promise<SaleResult> {
    const now = clock();
    const verification = sale.overeni || submit.verify === true;
    const saleAt = Date.parse(sale.data.dat_trzby);
    const sync = submit.mode !== "async";
    const record: SaleRecord = {
      id: crypto.randomUUID(),
      register,
      idempotencyKey: submit.idempotencyKey || undefined,
      saleKey: saleKey(sale.data),
      verification,
      firstSubmission: sale.prvni_zaslani,
      data: sale.data,
      ingestWarnings: warnings,
      saleAt,
      deadlineAt: verification ? undefined : saleAt + DEADLINE_MS,
      createdAt: now,
      status: "queued",
      attempts: 0,
      nextAttemptAt: now,
      // A sync caller holds the record from the start, so no worker races it.
      leaseUntil: sync ? now + leaseMs : undefined,
      updatedAt: now,
      eetWarnings: [],
    };
    const inserted = await store.insert(record);
    if (!inserted.inserted) return replay(inserted.existing, inserted.conflict, record, sync);
    if (!sync) {
      kick();
      return recordResult(record, now);
    }
    return track(record.id, () => attempt(record, now + leaseMs));
  }

  async function replay(
    existing: SaleRecord,
    conflict: "idempotency_key" | "sale_key",
    record: SaleRecord,
    sync: boolean,
  ): Promise<SaleResult> {
    const same =
      conflict === "idempotency_key"
        ? existing.register === record.register &&
          existing.verification === record.verification &&
          existing.firstSubmission === record.firstSubmission &&
          sameData(existing.data, record.data)
        : sameData(existing.data, record.data);
    if (!same) {
      return invalidResult(
        [
          conflict === "idempotency_key"
            ? {
                code: "idempotency_conflict",
                message: `Klíč idempotence "${record.idempotencyKey}" už patří jiné tržbě (${existing.id}).`,
              }
            : {
                code: "sale_conflict",
                message: `Tržba se stejným klíčem unikátnosti (rozhraní §4) a jinými údaji už je ve frontě (${existing.id}).`,
              },
        ],
        record.ingestWarnings,
      );
    }
    const running = sync ? inflight.get(existing.id) : undefined;
    // A failure of the other call is that call's to report; this one returns the record.
    const stored = () => recordResult(existing, clock());
    const result = running !== undefined ? await running.catch(stored) : stored();
    return {
      ...result,
      warnings: [
        ...result.warnings,
        {
          code: QueueWarningCode.SALE_REPLAYED,
          message: `Tržba už ve frontě je (${conflict === "idempotency_key" ? "stejný klíč idempotence" : "stejná tržba podle rozhraní §4"}); vrácen existující záznam, nic se neodeslalo.`,
          source: "queue",
        },
      ],
    };
  }

  /** One attempt of a record this caller holds until `leaseUntil`. */
  async function attempt(
    record: SaleRecord,
    leaseUntil: number,
    probe = false,
  ): Promise<SaleResult> {
    const register = registerOf(record.register);
    if (register === undefined) {
      await store.release(record.id, leaseUntil, { ...stateOf(record), leaseUntil: undefined });
      throw new QueueError(
        "unknown_register",
        `Pokladna "${record.register}" není nakonfigurovaná.`,
      );
    }
    const { transport } = register;
    const n = record.attempts + 1;
    const startedAt = clock();
    const timeZone = register.context?.timeZone;
    const header = createHeader({
      // Only the very first attempt is a first submission, even if it failed (metodika 1.3).
      prvni_zaslani: n === 1 && record.firstSubmission,
      ...(record.verification ? { overeni: true } : {}),
      now: new Date(startedAt),
      ...(timeZone !== undefined ? { timeZone } : {}),
    });
    try {
      await store.beginAttempt({
        saleId: record.id,
        n,
        uuid_zpravy: header.uuid_zpravy,
        dat_odesl: header.dat_odesl,
        prvni_zaslani: header.prvni_zaslani,
        overeni: record.verification,
        environment: transport.environment,
        endpoint: transport.endpoint,
        startedAt,
      });
    } catch (error) {
      // Nothing was sent; give the record back.
      await store
        .release(record.id, leaseUntil, { ...stateOf(record), leaseUntil: undefined })
        .catch(() => undefined);
      throw error;
    }
    let outcome: Outcome;
    try {
      outcome = await transport.send(
        { data: record.data, header },
        { signal: AbortSignal.timeout(Math.floor(leaseMs / 2)) },
      );
    } catch (error) {
      outcome = { kind: "uncertain", reason: "transport_error", message: errorMessage(error) };
    }
    return settle(record, n, header.uuid_zpravy, transport, outcome, startedAt, probe);
  }

  async function settle(
    record: SaleRecord,
    n: number,
    uuid: string,
    transport: EetTransport,
    outcome: Outcome,
    startedAt: number,
    probe: boolean,
  ): Promise<SaleResult> {
    const now = clock();
    const code = outcome.kind === "rejected" ? outcome.code : undefined;
    const code8Rejections =
      code === 8
        ? 1 +
          (await store.attempts(record.id)).filter((a) => a.outcome === "rejected" && a.code === 8)
            .length
        : 0;
    const reason =
      outcome.kind === "not_sent" || outcome.kind === "uncertain" ? outcome.reason : undefined;
    const decision = decide(
      { kind: outcome.kind, reason, code },
      { attempt: n, previousStatus: record.status, code8Rejections },
      policy,
      random,
    );
    const answered =
      outcome.kind === "accepted" ||
      outcome.kind === "verification_ok" ||
      outcome.kind === "rejected";
    const meta = "meta" in outcome ? outcome.meta : undefined;
    const pok = outcome.kind === "accepted" ? outcome.pok : undefined;
    const message = "message" in outcome ? outcome.message : undefined;
    const state: SaleState = {
      status: decision.status,
      attempts: n,
      nextAttemptAt: decision.retryInMs === undefined ? undefined : now + decision.retryInMs,
      leaseUntil: undefined,
      updatedAt: now,
      uuid,
      pok,
      test: answered ? outcome.test : undefined,
      code,
      message,
      reason,
      httpStatus: meta?.httpStatus,
      globalTransactionId: meta?.globalTransactionId,
      eetWarnings: answered ? outcome.warnings : [],
    };
    updateGate(transport.endpoint, outcome, probe, now);
    const updated = withState(record, state);
    try {
      const finished = await store.finishAttempt(
        record.id,
        n,
        {
          finishedAt: now,
          outcome: outcome.kind,
          reason,
          code,
          message,
          pok,
          httpStatus: meta?.httpStatus,
          globalTransactionId: meta?.globalTransactionId,
          durationMs: meta?.durationMs ?? now - startedAt,
        },
        state,
      );
      if (!finished) {
        emit({
          type: "error",
          id: record.id,
          message: `Pokus ${n} už byl uzavřen jako přerušený (vypršela výhrada); výsledek ${outcome.kind} se neuložil.`,
        });
        const current = await store.get(record.id);
        return recordResult(current ?? updated, now);
      }
    } catch (error) {
      // The caller still learns the outcome; recovery resends after the lease runs out.
      emit({
        type: "error",
        id: record.id,
        message: `Výsledek se neuložil: ${errorMessage(error)}`,
      });
    }
    report(updated, n, { kind: outcome.kind, reason, code, message }, decision.attention, now);
    const result = recordResult(updated, now);
    if (meta?.rawRequest !== undefined) result.rawRequest = meta.rawRequest;
    if (meta?.rawResponse !== undefined) result.rawResponse = meta.rawResponse;
    return result;
  }

  function report(
    record: SaleRecord,
    n: number,
    outcome: {
      kind: AttemptOutcome;
      reason?: string | undefined;
      code?: number | undefined;
      message?: string | undefined;
    },
    attention: boolean,
    now: number,
  ) {
    emit({
      type: "attempt",
      id: record.id,
      register: record.register,
      attempt: n,
      outcome: outcome.kind,
      reason: outcome.reason,
      code: outcome.code,
      status: record.status,
      nextAttemptAt:
        record.nextAttemptAt === undefined
          ? undefined
          : new Date(record.nextAttemptAt).toISOString(),
    });
    if (attention) {
      emit({
        type: "needs_attention",
        id: record.id,
        register: record.register,
        status: record.status,
        reason: outcome.reason,
        code: outcome.code,
        message: outcome.message,
      });
    }
    if (isOverdue(record, now) && record.deadlineAt !== undefined) {
      emit({
        type: "overdue",
        id: record.id,
        register: record.register,
        deadlineAt: new Date(record.deadlineAt).toISOString(),
        attempts: n,
      });
    }
  }

  function updateGate(endpoint: string, outcome: Outcome, probe: boolean, now: number) {
    const reason =
      outcome.kind === "not_sent" || outcome.kind === "uncertain" ? outcome.reason : "";
    if (reason === "network" || reason === "timeout") {
      const gate = gates.get(endpoint);
      if (gate === undefined) {
        gates.set(endpoint, { failures: 1, probeAt: now + backoffDelay(1, policy, random) });
      } else if (probe) {
        gate.failures += 1;
        gate.probeAt = now + backoffDelay(gate.failures, policy, random);
      }
    } else if (
      // Something answered (EET, a proxy, a forged endpoint): the connection works.
      !["signer", "too_large", "aborted", "transport_error"].includes(reason)
    ) {
      gates.delete(endpoint);
    }
  }

  /** Closes attempts whose lease ran out (the process died or hung) as `interrupted`. */
  async function recover(now: number) {
    for (const record of await store.expiredLeases(now)) {
      const leaseUntil = record.leaseUntil as number;
      const open = (await store.attempts(record.id)).find((a) => a.finishedAt === undefined);
      if (open === undefined) {
        // Leased but never started: nothing was sent.
        await store.release(record.id, leaseUntil, {
          ...stateOf(record),
          leaseUntil: undefined,
          updatedAt: now,
        });
        continue;
      }
      const decision = decide(
        { kind: "interrupted", reason: "interrupted" },
        { attempt: open.n, previousStatus: record.status, code8Rejections: 0 },
        policy,
        random,
      );
      const message =
        "Pokus byl přerušen (pád procesu nebo vypršená výhrada); není známo, zda zpráva do EET došla.";
      const state: SaleState = {
        status: decision.status,
        attempts: open.n,
        nextAttemptAt: decision.retryInMs === undefined ? undefined : now + decision.retryInMs,
        leaseUntil: undefined,
        updatedAt: now,
        uuid: open.uuid_zpravy,
        message,
        reason: "interrupted",
        eetWarnings: [],
      };
      const closedNow = await store.finishAttempt(
        record.id,
        open.n,
        { finishedAt: now, outcome: "interrupted", reason: "interrupted", message },
        state,
      );
      if (closedNow) {
        report(
          withState(record, state),
          open.n,
          { kind: "interrupted", reason: "interrupted", message },
          decision.attention,
          now,
        );
      }
    }
  }

  function launch(records: readonly SaleRecord[], probeOf?: string) {
    for (const record of records) {
      if (probeOf !== undefined) probing.add(probeOf);
      const promise: Promise<unknown> = track(record.id, () =>
        attempt(record, record.leaseUntil as number, probeOf !== undefined),
      )
        .catch((error) => emit({ type: "error", id: record.id, message: errorMessage(error) }))
        .finally(() => {
          running.delete(promise);
          if (probeOf !== undefined) probing.delete(probeOf);
          kick();
        });
      running.add(promise);
    }
  }

  /** One worker pass: recover, then claim due records within `concurrency` and the gate. */
  async function pass() {
    const now = clock();
    await recover(now);
    const leaseUntil = now + leaseMs;
    const free = () => concurrency - running.size;
    const healthy: string[] = [];
    const down = new Map<string, string[]>();
    for (const id of registerIds) {
      const endpoint = (registerOf(id) as RegisterConfig).transport.endpoint;
      if (!gates.has(endpoint)) healthy.push(id);
      else down.set(endpoint, [...(down.get(endpoint) ?? []), id]);
    }
    if (free() > 0 && healthy.length > 0)
      launch(await store.claimDue(now, free(), leaseUntil, { registers: healthy }));
    if (down.size === 0) return;
    // First attempts are never held back (an attempt is due when the sale happens, metodika
    // 1.3); resends to an unreachable endpoint wait for one probe to get through.
    if (free() > 0) {
      const ids = [...down.values()].flat();
      launch(
        await store.claimDue(now, free(), leaseUntil, { registers: ids, firstAttemptOnly: true }),
      );
    }
    for (const [endpoint, ids] of down) {
      const probeAt = gates.get(endpoint)?.probeAt ?? now;
      if (free() <= 0 || probing.has(endpoint) || probeAt > now) continue;
      launch(await store.claimDue(now, 1, leaseUntil, { registers: ids }), endpoint);
    }
  }

  function tick(): Promise<void> {
    if (ticking !== undefined) {
      again = true;
      return ticking;
    }
    const current = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } catch (error) {
        emit({ type: "error", message: `Worker: ${errorMessage(error)}` });
      } finally {
        ticking = undefined;
      }
    })();
    ticking = current;
    return current;
  }

  function kick() {
    if (!closed) void tick();
  }

  return {
    async submit(input, submitOptions = {}) {
      const prepared = prepare(input, submitOptions.register);
      if (!prepared.ok) return invalidResult(prepared.issues, prepared.warnings);
      return enqueue(prepared.register, prepared.sale, prepared.warnings, submitOptions);
    },

    async submitBatch(source, format, batchOptions = {}) {
      const read = readSales(source, format);
      const rows: { row: number; result: SaleResult }[] = [];
      for (const { row, input, warnings, issues } of read.rows) {
        const prepared =
          issues.length > 0
            ? ({ ok: false, issues, warnings } as const)
            : prepare(input, inputRegister(input) ?? batchOptions.register, warnings);
        if (!prepared.ok) {
          rows.push({ row, result: invalidResult(prepared.issues, prepared.warnings) });
          continue;
        }
        const key = batchOptions.idempotencyKey;
        const rowOptions = { ...batchOptions, idempotencyKey: key ? `${key}:${row}` : undefined };
        const result = await enqueue(
          prepared.register,
          prepared.sale,
          prepared.warnings,
          rowOptions,
        );
        rows.push({ row, result });
      }
      return { rows, warnings: read.warnings, issues: read.issues };
    },

    validateBatch(source, format, validateOptions = {}) {
      const read = readSales(source, format);
      const rows = read.rows.map(({ row, input, warnings, issues }) => {
        const prepared =
          issues.length > 0
            ? ({ ok: false, issues, warnings } as const)
            : prepare(input, inputRegister(input) ?? validateOptions.register, warnings);
        const result: ValidationResult = prepared.ok
          ? {
              valid: true,
              register: prepared.register,
              data: prepared.sale.data,
              overeni: prepared.sale.overeni || validateOptions.verify === true,
              prvni_zaslani: prepared.sale.prvni_zaslani,
              warnings: prepared.warnings,
              issues: [],
            }
          : { valid: false, warnings: prepared.warnings, issues: prepared.issues };
        return { row, result };
      });
      return { rows, warnings: read.warnings, issues: read.issues };
    },

    async get(id) {
      const record = await store.get(id);
      return record === undefined ? undefined : recordResult(record, clock());
    },

    attempts(id) {
      return store.attempts(id);
    },

    async retry(id) {
      const running = inflight.get(id);
      if (running !== undefined) return running;
      const record = await store.get(id);
      if (record === undefined) throw new QueueError("not_found", `Záznam ${id} neexistuje.`);
      if (registerOf(record.register) === undefined)
        throw new QueueError(
          "unknown_register",
          `Pokladna "${record.register}" není nakonfigurovaná.`,
        );
      if (FINAL.has(record.status))
        throw new QueueError(
          "not_retryable",
          `Záznam ve stavu ${record.status} se znovu neposílá.`,
        );
      const leaseUntil = clock() + leaseMs;
      const claimed = await store.claim(id, leaseUntil);
      if (claimed === undefined)
        throw new QueueError("in_progress", `Záznam ${id} se právě odesílá.`);
      // It may have been settled between reading and claiming.
      if (FINAL.has(claimed.status)) {
        await store.release(id, leaseUntil, { ...stateOf(claimed), leaseUntil: undefined });
        throw new QueueError(
          "not_retryable",
          `Záznam ve stavu ${claimed.status} se znovu neposílá.`,
        );
      }
      return track(id, () => attempt(claimed, leaseUntil));
    },

    async list(listOptions = {}) {
      const now = clock();
      const status =
        typeof listOptions.status === "string" ? [listOptions.status] : listOptions.status;
      const page = await store.list({
        status,
        register: listOptions.register,
        saleFrom: toMs(listOptions.from, "from"),
        saleTo: toMs(listOptions.to, "to"),
        overdue: listOptions.overdue,
        now,
        limit: Math.min(Math.max(1, Math.trunc(listOptions.limit ?? 50)), 500),
        cursor: listOptions.cursor,
      });
      const items = page.items.map((r) => recordResult(r, now));
      return page.nextCursor === undefined ? { items } : { items, nextCursor: page.nextCursor };
    },

    async runDue() {
      for (;;) {
        await tick();
        if (running.size === 0 && ticking === undefined) return;
        await Promise.allSettled([...running]);
      }
    },

    start() {
      closed = false;
      timer ??= setInterval(kick, pollIntervalMs);
      kick();
    },

    async stop() {
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await ticking;
      await Promise.allSettled([...running, ...inflight.values()]);
    },
  };
}

function registerConflict(sale: NormalizedSale, register: string): SaleIssue | undefined {
  if (sale.register === undefined || sale.register === register) return undefined;
  return {
    code: "conflicting_fields",
    message: `Vstup určuje pokladnu "${sale.register}", volání pokladnu "${register}".`,
    field: "register",
  };
}

function sameData(a: EetReceiptData, b: EetReceiptData): boolean {
  return DATA_FIELDS.every((field) => a[field] === b[field]);
}

function toMs(value: Date | string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`${name}: neplatné datum`);
  return ms;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validate(policy: RetryPolicy, concurrency: number, leaseMs: number, pollMs: number) {
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new RangeError(message);
  };
  check(Number.isInteger(concurrency) && concurrency >= 1, "concurrency must be an integer ≥ 1");
  // Half the lease bounds an attempt; EET needs at least 2 s to answer (ZoET §19).
  check(Number.isFinite(leaseMs) && leaseMs >= 4_000, "leaseMs must be ≥ 4000");
  check(Number.isFinite(pollMs) && pollMs > 0, "pollIntervalMs must be > 0");
  check(policy.initialDelayMs > 0, "retry.initialDelayMs must be > 0");
  check(policy.maxDelayMs >= policy.initialDelayMs, "retry.maxDelayMs must be ≥ initialDelayMs");
  check(
    Number.isInteger(policy.code8Attempts) && policy.code8Attempts >= 1,
    "retry.code8Attempts must be an integer ≥ 1",
  );
  check(policy.jitter >= 0 && policy.jitter < 1, "retry.jitter must be in [0, 1)");
}
