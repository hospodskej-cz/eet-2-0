package cz.hospodskej.eetgateway;

import java.util.Map;

/** One row of a validation result. */
public record ValidationRow(int row, ValidationResult result) {
  static ValidationRow fromJson(Map<String, Object> d) {
    return new ValidationRow(
        Json.rint(d, "row"), ValidationResult.fromJson(Json.robj(d, "result")));
  }
}
