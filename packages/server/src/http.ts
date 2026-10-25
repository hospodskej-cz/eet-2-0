/** HTTP helpers of API v1: status codes, errors, media types and API-key checks. */
import { QueueWarningCode, type SaleResult } from "@eet-gateway/queue";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "not_retryable"
  | "in_progress"
  | "unknown_register"
  | "payload_too_large"
  | "unsupported_media_type"
  | "single_sale_expected"
  | "internal";

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

/**
 * EET answered (accepted, verification_ok, rejected) → 200; still on its way (queued, uncertain)
 * → 202; local validation failed → 422, an idempotency key reused for another sale → 409.
 */
export function saleStatusCode(result: SaleResult): 200 | 202 | 409 | 422 {
  switch (result.status) {
    case "queued":
    case "uncertain":
      return 202;
    case "invalid":
      return result.issues?.some((i) => i.code === "idempotency_conflict") ? 409 : 422;
    default:
      return 200;
  }
}

export function isReplay(result: SaleResult): boolean {
  return result.warnings.some(
    (w) => w.source === "queue" && w.code === QueueWarningCode.SALE_REPLAYED,
  );
}

/** `type/subtype` of a `Content-Type`, lower-cased, without parameters. */
export function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** `true`/`false`/`1`/`0`; anything else is undefined. */
export function parseFlag(value: string | undefined): boolean | undefined {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

/** Checks bearer tokens against the configured keys in constant time (SHA-256 digests). */
export function apiKeyChecker(keys: readonly string[]): (token: string) => Promise<boolean> {
  const digests = Promise.all(keys.map(sha256));
  return async (token) => {
    const candidate = await sha256(token);
    let match = false;
    for (const digest of await digests) match = equal(candidate, digest) || match;
    return match;
  };
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}
