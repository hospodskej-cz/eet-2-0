package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Result of POST /v1/validate. When {@code issues} is not empty the source could not be read
 * (HTTP 422).
 */
public record ValidationBatch(
    List<ValidationRow> rows, List<SaleWarning> warnings, List<Issue> issues) {
  static ValidationBatch fromJson(Map<String, Object> d) {
    List<ValidationRow> rows = new ArrayList<>();
    for (Map<String, Object> r : Json.objects(d, "rows")) rows.add(ValidationRow.fromJson(r));
    return new ValidationBatch(List.copyOf(rows), SaleWarning.listFrom(d), Issue.listFrom(d));
  }

  /** The source was readable and every row is valid. */
  public boolean isValid() {
    return issues.isEmpty() && rows.stream().allMatch(r -> r.result().valid());
  }
}
