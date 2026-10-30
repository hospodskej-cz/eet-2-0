package cz.hospodskej.eetgateway;

import java.util.Map;

/** 400: a query parameter or header is invalid. */
public class BadRequestException extends ApiException {
  private static final long serialVersionUID = 1L;

  public BadRequestException(int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
