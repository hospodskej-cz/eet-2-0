package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A change or remark made while handling a sale ({@code warnings[]}).
 *
 * @param source "eet", "ingest" or "queue"
 * @param field the field it is about, or null
 */
public record SaleWarning(int code, String message, String source, String field) {
  static SaleWarning fromJson(Map<String, Object> d) {
    return new SaleWarning(
        Json.rint(d, "code"), Json.rstr(d, "message"), Json.rstr(d, "source"), Json.str(d, "field"));
  }

  static List<SaleWarning> listFrom(Map<String, Object> d) {
    List<SaleWarning> out = new ArrayList<>();
    for (Map<String, Object> w : Json.objects(d, "warnings")) out.add(fromJson(w));
    return List.copyOf(out);
  }
}
