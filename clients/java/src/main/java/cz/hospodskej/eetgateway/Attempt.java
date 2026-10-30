package cz.hospodskej.eetgateway;

import java.util.Map;

/**
 * One message sent to EET for a sale (GET /v1/sales/{id}/attempts).
 *
 * @param environment "playground" or "production"
 * @param finishedAt absent while the attempt is running
 * @param outcome accepted, verification_ok, rejected, not_sent, uncertain or interrupted
 */
public record Attempt(
    int n,
    String uuidZpravy,
    String datOdesl,
    boolean prvniZaslani,
    boolean overeni,
    String environment,
    String endpoint,
    String startedAt,
    String finishedAt,
    String outcome,
    String reason,
    Integer code,
    String message,
    String pok,
    Integer httpStatus,
    String globalTransactionId,
    Integer durationMs) {
  static Attempt fromJson(Map<String, Object> d) {
    return new Attempt(
        Json.rint(d, "n"),
        Json.rstr(d, "uuid_zpravy"),
        Json.rstr(d, "dat_odesl"),
        Json.rbool(d, "prvni_zaslani"),
        Json.rbool(d, "overeni"),
        Json.rstr(d, "environment"),
        Json.rstr(d, "endpoint"),
        Json.rstr(d, "startedAt"),
        Json.str(d, "finishedAt"),
        Json.str(d, "outcome"),
        Json.str(d, "reason"),
        Json.integer(d, "code"),
        Json.str(d, "message"),
        Json.str(d, "pok"),
        Json.integer(d, "httpStatus"),
        Json.str(d, "globalTransactionId"),
        Json.integer(d, "durationMs"));
  }
}
