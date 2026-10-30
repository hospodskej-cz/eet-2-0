package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A configured cash register and its certificates (GET /v1/registers).
 *
 * @param environment "playground" or "production"
 * @param defaults eic_popl, id_jednotky, id_pokl as far as configured
 */
public record Register(
    String id,
    String environment,
    String endpoint,
    String timeZone,
    Map<String, String> defaults,
    List<Certificate> certificates) {
  static Register fromJson(Map<String, Object> d) {
    Map<String, String> defaults = new LinkedHashMap<>();
    Map<String, Object> raw = Json.obj(d, "defaults");
    if (raw != null) raw.forEach((k, v) -> defaults.put(k, String.valueOf(v)));
    List<Certificate> certificates = new ArrayList<>();
    for (Map<String, Object> c : Json.objects(d, "certificates")) {
      certificates.add(Certificate.fromJson(c));
    }
    return new Register(
        Json.rstr(d, "id"),
        Json.rstr(d, "environment"),
        Json.rstr(d, "endpoint"),
        Json.rstr(d, "timeZone"),
        Map.copyOf(defaults),
        List.copyOf(certificates));
  }
}
