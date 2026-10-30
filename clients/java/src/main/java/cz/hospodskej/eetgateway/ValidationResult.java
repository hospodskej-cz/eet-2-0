package cz.hospodskej.eetgateway;

import java.util.List;
import java.util.Map;

/**
 * Whether one sale would be sent, as POST /v1/validate says.
 *
 * @param data the EET {@code <Data>} that would be sent, null when invalid
 * @param overeni verification mode
 * @param prvniZaslani first submission
 */
public record ValidationResult(
    boolean valid,
    List<SaleWarning> warnings,
    List<Issue> issues,
    String register,
    SaleData data,
    Boolean overeni,
    Boolean prvniZaslani) {
  static ValidationResult fromJson(Map<String, Object> d) {
    Map<String, Object> data = Json.obj(d, "data");
    return new ValidationResult(
        Json.rbool(d, "valid"),
        SaleWarning.listFrom(d),
        Issue.listFrom(d),
        Json.str(d, "register"),
        data == null ? null : SaleData.fromJson(data),
        Json.bool(d, "overeni"),
        Json.bool(d, "prvni_zaslani"));
  }
}
