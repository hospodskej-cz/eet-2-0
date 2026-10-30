package cz.hospodskej.eetgateway;

import java.util.Map;

/** The gateway answered with an error status. */
public class ApiException extends EetGatewayException {
  private static final long serialVersionUID = 1L;

  private final int status;
  private final String code;
  private final String detail;
  private final transient Map<String, String> headers;

  public ApiException(int status, String code, String detail, Map<String, String> headers) {
    super("HTTP " + status + " " + code + ": " + detail);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.headers = headers == null ? Map.of() : Map.copyOf(headers);
  }

  /** The HTTP status. */
  public int status() {
    return status;
  }

  /** Stable machine-readable code from the {@code {"error": {"code"}}} body, e.g. not_found. */
  public String code() {
    return code;
  }

  /** The message of the error body, without the status and code. */
  public String detail() {
    return detail;
  }

  /** Response headers, names in lower case. */
  public Map<String, String> headers() {
    return headers;
  }
}
