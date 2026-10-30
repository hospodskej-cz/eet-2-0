package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Body of GET /health. {@code status} is "ok" or "degraded" (HTTP 503 is returned, not thrown).
 *
 * @param database "ok" or "error"
 * @param eet only with {@code checkEet = true}, otherwise null
 */
public record Health(String status, String version, String database, List<EetCheck> eet) {
  static Health fromJson(Map<String, Object> d) {
    List<EetCheck> eet = null;
    if (Json.array(d.get("eet")) != null) {
      List<EetCheck> checks = new ArrayList<>();
      for (Map<String, Object> e : Json.objects(d, "eet")) checks.add(EetCheck.fromJson(e));
      eet = List.copyOf(checks);
    }
    return new Health(
        Json.rstr(d, "status"), Json.rstr(d, "version"), Json.rstr(d, "database"), eet);
  }

  /** The gateway answered "ok". */
  public boolean isOk() {
    return "ok".equals(status);
  }
}
