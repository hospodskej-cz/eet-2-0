package cz.hospodskej.eetgateway;

import java.util.Map;

/** Reachability of one EET endpoint ({@code /health?eet=true}). */
public record EetCheck(
    String endpoint,
    boolean reachable,
    double durationMs,
    String checkedAt,
    Integer httpStatus,
    String error) {
  static EetCheck fromJson(Map<String, Object> d) {
    return new EetCheck(
        Json.rstr(d, "endpoint"),
        Json.rbool(d, "reachable"),
        Json.rnum(d, "durationMs"),
        Json.rstr(d, "checkedAt"),
        Json.integer(d, "httpStatus"),
        Json.str(d, "error"));
  }
}
