/**
 * `EetTransport` — the protocol boundary of the gateway (docs/ADR-001-protocol-core.md). One
 * `send()` is exactly one signed `OdeslaniTrzby` round trip: no retries, no persistence. The
 * outcome reports facts; what to do next (resend, alert, give up) is the queue's decision.
 */
import type { EetEnvironment } from "./certificate.ts";
import type { EetHeader, EetReceiptData } from "./schema.ts";

export interface TransportRequest {
  readonly data: EetReceiptData;
  /** Fresh per attempt: new `uuid_zpravy` and `dat_odesl` (SPEC_NOTES §11). */
  readonly header: EetHeader;
}

export interface EetWarning {
  /** `kod_varov` (rozhraní §3.4.4). */
  readonly code: number;
  readonly message: string;
}

export interface TransportMeta {
  readonly httpStatus?: number | undefined;
  /** `X-Global-Transaction-Id` response header (rozhraní §5.4). */
  readonly globalTransactionId?: string | undefined;
  readonly durationMs: number;
  /** Only with `debug: true`; `<SignatureValue>` is replaced by `[redacted]`. */
  readonly rawRequest?: string | undefined;
  /** Only with `debug: true`; `<SignatureValue>` is replaced by `[redacted]`. */
  readonly rawResponse?: string | undefined;
}

/**
 * Why the result is unknown. The message may or may not have reached EET:
 * - `timeout`: no answer within `timeoutMs`
 * - `network`: connection dropped after it was (possibly) established
 * - `aborted`: the caller's `AbortSignal` fired
 * - `http`: unexpected HTTP status without an EET answer (e.g. proxy error page)
 * - `soap_fault`: SOAP Fault instead of `<Odpoved>` (rozhraní §3.5.4 note ****)
 * - `malformed_response`: not well-formed XML or not the EET response structure
 * - `signature`: `<Potvrzeni>` whose signature could not be trusted (ADR-002)
 * - `environment_mismatch`: playground answer from a production endpoint or vice versa
 */
export type UncertainReason =
  | "timeout"
  | "network"
  | "aborted"
  | "http"
  | "soap_fault"
  | "malformed_response"
  | "signature"
  | "environment_mismatch";

/** Why nothing was sent: connection never established, signing failed, or envelope > 12 kB. */
export type NotSentReason = "network" | "signer" | "too_large" | "aborted";

export type TransportOutcome =
  | {
      readonly kind: "accepted";
      readonly pok: string;
      readonly uuid_zpravy: string;
      readonly dat_prij: string;
      readonly test: boolean;
      readonly warnings: readonly EetWarning[];
      readonly meta: TransportMeta;
    }
  | {
      readonly kind: "verification_ok";
      readonly uuid_zpravy?: string | undefined;
      readonly test: boolean;
      readonly warnings: readonly EetWarning[];
      readonly meta: TransportMeta;
    }
  | {
      readonly kind: "rejected";
      /** `kod` (rozhraní §3.5.4); negative codes are temporary technical errors. */
      readonly code: number;
      readonly message: string;
      readonly uuid_zpravy?: string | undefined;
      readonly dat_odmit?: string | undefined;
      readonly test: boolean;
      readonly warnings: readonly EetWarning[];
      readonly meta: TransportMeta;
    }
  | {
      readonly kind: "not_sent";
      readonly reason: NotSentReason;
      readonly message: string;
      readonly meta: TransportMeta;
    }
  | {
      readonly kind: "uncertain";
      readonly reason: UncertainReason;
      readonly message: string;
      readonly meta: TransportMeta;
    };

export interface SendOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface EetTransport {
  readonly environment: EetEnvironment;
  readonly endpoint: string;
  send(request: TransportRequest, options?: SendOptions): Promise<TransportOutcome>;
}
