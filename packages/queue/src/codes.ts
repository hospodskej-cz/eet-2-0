/**
 * Stable warning and issue codes of @eet-gateway/queue — public API documented in docs/QUEUE.md.
 * They extend the ingest codes (docs/INGEST.md) and never reuse their numbers.
 */

export const QueueWarningCode = {
  /**
   * The sale is already in the queue — same idempotency key, or the same sale by its uniqueness
   * key (rozhraní §4). The existing record is returned; nothing new was stored or sent.
   */
  SALE_REPLAYED: 1071,
} as const;

export type QueueIssueCode =
  /** The register is not configured, or several are and the call names none. */
  | "unknown_register"
  /** The idempotency key was already used for a different sale. */
  | "idempotency_conflict"
  /** A sale with the same uniqueness key (rozhraní §4) but different other data is queued. */
  | "sale_conflict";

export type QueueErrorCode =
  /** No record with this id. */
  | "not_found"
  /** `accepted`, `verification_ok` and `invalid` records are final. */
  | "not_retryable"
  /** The record's register is not configured in this queue. */
  | "unknown_register"
  /** Another worker or process holds the record right now. */
  | "in_progress";

export class QueueError extends Error {
  override readonly name = "QueueError";
  readonly code: QueueErrorCode;

  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
