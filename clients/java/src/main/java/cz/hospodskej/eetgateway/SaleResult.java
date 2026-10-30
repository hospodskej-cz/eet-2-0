package cz.hospodskej.eetgateway;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The state of one sale: the body of POST /v1/sales, GET /v1/sales/{id} and the queue items.
 * Fields that do not apply to the status are null.
 *
 * @param status {@code accepted}, {@code verification_ok}, {@code rejected}, {@code queued},
 *     {@code uncertain} or {@code invalid}; see {@link #knownStatus()}
 * @param id absent when nothing was stored ({@code invalid})
 * @param pok fiscal identification code, {@code accepted} only
 * @param uuid {@code uuid_zpravy} of the last attempt
 * @param test EET answered from the playground
 * @param code EET error code of the last answer ({@code kod})
 * @param reason why the last attempt has no EET answer: timeout, network, ...
 * @param nextAttemptAt ISO 8601 UTC
 * @param overdue no POK 48 hours after the sale (ZoET section 20)
 * @param rawRequest debug only
 * @param rawResponse debug only
 * @param location {@code Location} header of the submit response ({@code /v1/sales/{id}})
 * @param replayed {@code Idempotent-Replayed: true}, the stored result of an earlier call with the
 *     same key
 */
public record SaleResult(
    String status,
    List<SaleWarning> warnings,
    int attempts,
    String id,
    String register,
    SaleData data,
    String pok,
    String uuid,
    Boolean test,
    Integer code,
    String message,
    String reason,
    List<Issue> issues,
    String nextAttemptAt,
    Boolean overdue,
    String createdAt,
    String deadlineAt,
    Integer httpStatus,
    String globalTransactionId,
    String rawRequest,
    String rawResponse,
    String location,
    boolean replayed) {

  static SaleResult fromJson(Map<String, Object> d, String location, boolean replayed) {
    Map<String, Object> data = Json.obj(d, "data");
    Integer attempts = Json.integer(d, "attempts");
    return new SaleResult(
        Json.rstr(d, "status"),
        SaleWarning.listFrom(d),
        attempts == null ? 0 : attempts,
        Json.str(d, "id"),
        Json.str(d, "register"),
        data == null ? null : SaleData.fromJson(data),
        Json.str(d, "pok"),
        Json.str(d, "uuid"),
        Json.bool(d, "test"),
        Json.integer(d, "code"),
        Json.str(d, "message"),
        Json.str(d, "reason"),
        Issue.listFrom(d),
        Json.str(d, "nextAttemptAt"),
        Json.bool(d, "overdue"),
        Json.str(d, "createdAt"),
        Json.str(d, "deadlineAt"),
        Json.integer(d, "httpStatus"),
        Json.str(d, "globalTransactionId"),
        Json.str(d, "rawRequest"),
        Json.str(d, "rawResponse"),
        location,
        replayed);
  }

  /** The status as an enum, empty for a status this library does not know yet. */
  public Optional<SaleStatus> knownStatus() {
    return SaleStatus.of(status);
  }

  /** EET accepted the sale, or (verification mode) found it correct. */
  public boolean isSuccess() {
    return "accepted".equals(status) || "verification_ok".equals(status);
  }

  /** {@code queued} or {@code uncertain}: not decided yet, the gateway keeps going. */
  public boolean isPending() {
    return "queued".equals(status) || "uncertain".equals(status);
  }

  /** Nothing more will happen without a manual retry. */
  public boolean isFinal() {
    return !isPending();
  }
}
