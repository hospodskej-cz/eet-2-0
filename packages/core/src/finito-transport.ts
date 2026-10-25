/**
 * `EetTransport` implemented on top of `@finitoapp/eet-client` (docs/ADR-001-protocol-core.md).
 * The library builds, signs, sends and parses; this module adds environment guards, the response
 * trust policy (ADR-002), debug capture with redaction and the not-sent/uncertain classification.
 */
import {
  createEetClient,
  type EetError,
  type EetSigner,
  type EetSubmitOutcome,
} from "@finitoapp/eet-client";
import { parseEetReceiptData, parseHeader } from "@finitoapp/eet-client/builtin";
import type { EetEnvironment, RegisterCertificate } from "./certificate.ts";
import { EET_PLAYGROUND_ENDPOINT } from "./constants.ts";
import {
  createResponseVerifier,
  playgroundResponseTrust,
  productionResponseTrust,
  type ResponseTrust,
} from "./response-trust.ts";
import { EetHeaderSchema, EetReceiptDataSchema } from "./schema.ts";
import type {
  EetTransport,
  EetWarning,
  NotSentReason,
  SendOptions,
  TransportMeta,
  TransportOutcome,
  TransportRequest,
  UncertainReason,
} from "./transport.ts";

/** Default wait for the EET answer. */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** "Mezní doba odezvy" must be at least 2 s (ZoET §19, SPEC_NOTES §11). */
export const MIN_TIMEOUT_MS = 2_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CreateEetTransportOptions {
  readonly environment: EetEnvironment;
  /** Required for production (never hard-coded); defaults to the playground URL otherwise. */
  readonly endpoint?: string | undefined;
  readonly certificate: RegisterCertificate;
  /** Defaults to the profile of `environment` (ADR-002). */
  readonly responseTrust?: ResponseTrust | undefined;
  readonly timeoutMs?: number | undefined;
  /** Adds the raw request/response (with `<SignatureValue>` redacted) to `meta`. */
  readonly debug?: boolean | undefined;
  /** Allow a certificate not issued by a known CA EET issuing CA (e.g. after a CA rotation). */
  readonly allowUnknownCertificateIssuer?: boolean | undefined;
  readonly fetch?: FetchLike | undefined;
  /** Clock for the response-certificate validity check (tests). */
  readonly now?: (() => Date) | undefined;
}

export class TransportConfigError extends Error {
  override readonly name = "TransportConfigError";
}

const NOT_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ConnectionRefused",
  "FailedToOpenSocket",
]);
const TLS_CODE = /CERT|^ERR_TLS|^ERR_SSL|SELF_SIGNED|UNABLE_TO_VERIFY/;

type FetchFailure = { kind: "not_sent" | "uncertain"; reason: "network" | "timeout" | "aborted" };

function errorCode(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | undefined)?.cause]) {
    const code = (candidate as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * `fetch` cannot tell whether request bytes left the machine, so only failures that happen
 * before a connection exists (DNS, refused, TLS handshake) count as "not sent".
 */
function classifyFetchError(error: unknown, callerSignal: AbortSignal | undefined): FetchFailure {
  if (callerSignal?.aborted) return { kind: "uncertain", reason: "aborted" };
  const name = (error as { name?: unknown } | undefined)?.name;
  if (name === "TimeoutError" || name === "AbortError")
    return { kind: "uncertain", reason: "timeout" };
  const code = errorCode(error);
  if (code !== undefined && (NOT_SENT_CODES.has(code) || TLS_CODE.test(code))) {
    return { kind: "not_sent", reason: "network" };
  }
  return { kind: "uncertain", reason: "network" };
}

const SIGNATURE_VALUE =
  /(<(?:[\w.-]+:)?SignatureValue\b[^>]*>)[\s\S]*?(<\/(?:[\w.-]+:)?SignatureValue>)/g;

export function redactSignatureValues(xml: string): string {
  return xml.replace(SIGNATURE_VALUE, "$1[redacted]$2");
}

function decodeBody(body: RequestInit["body"]): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  return "";
}

function normalizeText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function mapWarnings(warnings: readonly { code: number; message?: string }[]): EetWarning[] {
  return warnings.map((w) => ({ code: w.code, message: normalizeText(w.message) }));
}

/** Drops `undefined` optionals: the protocol library requires them to be absent. */
function withoutUndefined<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

export function createEetTransport(options: CreateEetTransportOptions): EetTransport {
  const { environment, certificate } = options;
  if (certificate.environment === "unknown" && !options.allowUnknownCertificateIssuer) {
    throw new TransportConfigError(
      `certificate ${certificate.info.eic} was not issued by a known CA EET issuing CA (issuer "${certificate.info.issuerCommonName}")`,
    );
  }
  if (certificate.environment !== "unknown" && certificate.environment !== environment) {
    throw new TransportConfigError(
      `${certificate.environment} certificate ${certificate.info.eic} cannot be used for the ${environment} environment`,
    );
  }
  if (environment === "production" && !options.endpoint) {
    throw new TransportConfigError("the production endpoint must be configured explicitly");
  }
  const endpoint = options.endpoint ?? EET_PLAYGROUND_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS) {
    throw new TransportConfigError(`timeoutMs must be at least ${MIN_TIMEOUT_MS} (ZoET §19)`);
  }
  const trust =
    options.responseTrust ??
    (environment === "production" ? productionResponseTrust() : playgroundResponseTrust());
  const baseFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function send(
    request: TransportRequest,
    sendOptions: SendOptions = {},
  ): Promise<TransportOutcome> {
    const data = EetReceiptDataSchema.safeParse(request.data);
    const header = EetHeaderSchema.safeParse(request.header);
    if (!data.success || !header.success) {
      throw new TypeError(
        `invalid transport request: ${[
          ...(data.error?.issues ?? []),
          ...(header.error?.issues ?? []),
        ]
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }

    const started = performance.now();
    const callerSignal = sendOptions.signal;
    let fetchFailure: FetchFailure | undefined;
    let signatureFailure: string | undefined;
    let httpStatus: number | undefined;
    let globalTransactionId: string | undefined;
    let rawRequest: string | undefined;
    let rawResponse: string | undefined;

    const meta = (): TransportMeta => ({
      httpStatus,
      globalTransactionId,
      durationMs: Math.round(performance.now() - started),
      ...(options.debug ? { rawRequest, rawResponse } : {}),
    });

    if (callerSignal?.aborted) {
      return {
        kind: "not_sent",
        reason: "aborted",
        message: "aborted before sending",
        meta: meta(),
      };
    }

    const capturingFetch: FetchLike = async (input, init) => {
      if (options.debug) rawRequest = redactSignatureValues(decodeBody(init?.body));
      const signals = [init?.signal, callerSignal].filter((s): s is AbortSignal => s != null);
      try {
        const response = await baseFetch(input, {
          ...init,
          ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
        });
        httpStatus = response.status;
        globalTransactionId = response.headers.get("x-global-transaction-id") ?? undefined;
        if (options.debug) rawResponse = redactSignatureValues(await response.clone().text());
        return response;
      } catch (error) {
        fetchFailure = classifyFetchError(error, callerSignal);
        throw error;
      }
    };

    const client = createEetClient({
      endpoint,
      signer: certificate.signer as EetSigner,
      responseSignatureVerifier: createResponseVerifier(trust, {
        now: options.now,
        onFailure: (reason) => {
          signatureFailure = reason;
        },
      }),
      fetch: capturingFetch as typeof fetch,
      timeoutMs,
    });

    const finitoData = parseEetReceiptData(withoutUndefined(data.data));
    const finitoHeader = parseHeader({
      uuid: header.data.uuid_zpravy,
      sentAt: header.data.dat_odesl,
      firstSubmission: header.data.prvni_zaslani,
      verification: header.data.overeni ?? false,
    });
    if (!finitoData.ok || !finitoHeader.ok) {
      // Our schema accepted what the library rejects: a bug in one of the two validators.
      throw new Error(
        `schema mismatch with @finitoapp/eet-client: ${[
          ...(finitoData.ok ? [] : finitoData.error.issues),
          ...(finitoHeader.ok ? [] : finitoHeader.error.issues),
        ].join("; ")}`,
      );
    }

    const result = await client.submit(finitoData.value, finitoHeader.value);
    if (result.ok) return mapOutcome(result.value, meta());
    return mapError(result.error, fetchFailure, signatureFailure, meta());
  }

  function environmentMismatch(
    test: boolean,
    pok: string | undefined,
    accepted: boolean,
  ): string | undefined {
    if (environment === "production" && (test || pok?.toLowerCase().endsWith("-ff"))) {
      return 'the production endpoint answered as the playground (test="true" or POK ending in -ff) — nothing was registered';
    }
    if (environment === "playground" && accepted && !test) {
      return 'the playground endpoint answered without test="true" — check the configured endpoint';
    }
    return undefined;
  }

  function mapOutcome(outcome: EetSubmitOutcome, meta: TransportMeta): TransportOutcome {
    const mismatch = environmentMismatch(
      outcome.test,
      outcome.status === "accepted" ? outcome.pok : undefined,
      outcome.status === "accepted",
    );
    if (mismatch !== undefined) {
      return { kind: "uncertain", reason: "environment_mismatch", message: mismatch, meta };
    }
    switch (outcome.status) {
      case "accepted":
        return {
          kind: "accepted",
          pok: outcome.pok,
          uuid_zpravy: outcome.uuid,
          dat_prij: outcome.receivedAt,
          test: outcome.test,
          warnings: mapWarnings(outcome.warnings),
          meta,
        };
      case "verification":
        return {
          kind: "verification_ok",
          uuid_zpravy: outcome.uuid,
          test: outcome.test,
          warnings: mapWarnings(outcome.warnings),
          meta,
        };
      case "rejected":
        return {
          kind: "rejected",
          code: outcome.code,
          message: normalizeText(outcome.message),
          uuid_zpravy: outcome.uuid,
          dat_odmit: outcome.rejectedAt,
          test: outcome.test,
          warnings: mapWarnings(outcome.warnings),
          meta,
        };
    }
  }

  function mapError(
    error: EetError,
    fetchFailure: FetchFailure | undefined,
    signatureFailure: string | undefined,
    meta: TransportMeta,
  ): TransportOutcome {
    const notSent = (reason: NotSentReason, message: string): TransportOutcome => ({
      kind: "not_sent",
      reason,
      message,
      meta,
    });
    const uncertain = (reason: UncertainReason, message: string): TransportOutcome => ({
      kind: "uncertain",
      reason,
      message,
      meta,
    });
    switch (error.type) {
      case "EetValidationError":
        throw new Error(`@finitoapp/eet-client rejected validated input: ${error.message}`);
      case "EetMessageTooLargeError":
        return notSent("too_large", error.message);
      case "EetSignerError":
        return notSent("signer", error.message);
      case "EetNetworkError":
      case "EetTimeoutError": {
        const failure =
          fetchFailure ??
          (error.type === "EetTimeoutError"
            ? ({ kind: "uncertain", reason: "timeout" } as const)
            : ({ kind: "uncertain", reason: "network" } as const));
        return failure.kind === "not_sent"
          ? notSent("network", error.message)
          : uncertain(failure.reason, error.message);
      }
      case "EetHttpError":
        return uncertain("http", error.message);
      case "EetSoapFaultError":
        return uncertain("soap_fault", normalizeText(error.faultString ?? error.message));
      case "EetXmlError":
      case "EetResponseSchemaError":
        return uncertain("malformed_response", error.message);
      case "EetSignatureError":
        return uncertain("signature", signatureFailure ?? error.message);
    }
  }

  return { environment, endpoint, send };
}
