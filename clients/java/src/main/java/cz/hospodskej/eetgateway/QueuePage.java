package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * One page of GET /v1/queue, newest first.
 *
 * @param nextCursor pass as {@link QueueFilter#cursor(String)} for the next page, null on the last
 *     page
 */
public record QueuePage(List<SaleResult> items, String nextCursor) {
  static QueuePage fromJson(Map<String, Object> d) {
    List<SaleResult> items = new ArrayList<>();
    for (Map<String, Object> i : Json.objects(d, "items")) {
      items.add(SaleResult.fromJson(i, null, false));
    }
    return new QueuePage(List.copyOf(items), Json.str(d, "nextCursor"));
  }
}
