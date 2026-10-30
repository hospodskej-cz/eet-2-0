package cz.hospodskej.eetgateway;

import java.util.Map;

/** 401: the API key is missing or wrong. */
public class AuthenticationException extends ApiException {
  private static final long serialVersionUID = 1L;

  public AuthenticationException(
      int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
