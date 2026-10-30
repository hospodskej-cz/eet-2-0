package cz.hospodskej.eetgateway;

import java.util.Map;

/** 5xx: the gateway failed (details only in its log). */
public class ServerException extends ApiException {
  private static final long serialVersionUID = 1L;

  public ServerException(int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
