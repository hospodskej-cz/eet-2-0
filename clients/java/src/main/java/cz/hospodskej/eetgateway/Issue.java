package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Why a sale is invalid ({@code issues[]}).
 *
 * @param field the field it is about, or null
 */
public record Issue(String code, String message, String field) {
  static Issue fromJson(Map<String, Object> d) {
    return new Issue(Json.rstr(d, "code"), Json.rstr(d, "message"), Json.str(d, "field"));
  }

  static List<Issue> listFrom(Map<String, Object> d) {
    List<Issue> out = new ArrayList<>();
    for (Map<String, Object> i : Json.objects(d, "issues")) out.add(fromJson(i));
    return List.copyOf(out);
  }
}
