package cz.hospodskej.eetgateway;

import java.util.Map;

/**
 * A register's certificate.
 *
 * @param daysLeft negative once expired
 * @param active used for sending right now
 * @param expiresSoon valid, but expires within 21 days
 */
public record Certificate(
    String eic,
    String subject,
    String issuer,
    String serialNumber,
    String fingerprintSha256,
    String notBefore,
    String notAfter,
    int daysLeft,
    boolean active,
    boolean expiresSoon,
    boolean expired) {
  static Certificate fromJson(Map<String, Object> d) {
    return new Certificate(
        Json.rstr(d, "eic"),
        Json.rstr(d, "subject"),
        Json.rstr(d, "issuer"),
        Json.rstr(d, "serialNumber"),
        Json.rstr(d, "fingerprintSha256"),
        Json.rstr(d, "notBefore"),
        Json.rstr(d, "notAfter"),
        Json.rint(d, "daysLeft"),
        Json.rbool(d, "active"),
        Json.rbool(d, "expiresSoon"),
        Json.rbool(d, "expired"));
  }
}
