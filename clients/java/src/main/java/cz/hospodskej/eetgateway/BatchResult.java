package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Result of POST /v1/sales/batch. When {@code issues} is not empty the source could not be read
 * (HTTP 422).
 */
public record BatchResult(List<BatchRow> rows, List<SaleWarning> warnings, List<Issue> issues) {
  static BatchResult fromJson(Map<String, Object> d) {
    List<BatchRow> rows = new ArrayList<>();
    for (Map<String, Object> r : Json.objects(d, "rows")) rows.add(BatchRow.fromJson(r));
    return new BatchResult(List.copyOf(rows), SaleWarning.listFrom(d), Issue.listFrom(d));
  }
}
