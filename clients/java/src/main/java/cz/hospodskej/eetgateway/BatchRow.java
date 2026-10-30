package cz.hospodskej.eetgateway;

import java.util.Map;

/**
 * One row of a batch result.
 *
 * @param row JSON array: position from 1; NDJSON, CSV, XML: line number
 */
public record BatchRow(int row, SaleResult result) {
  static BatchRow fromJson(Map<String, Object> d) {
    return new BatchRow(
        Json.rint(d, "row"), SaleResult.fromJson(Json.robj(d, "result"), null, false));
  }
}
