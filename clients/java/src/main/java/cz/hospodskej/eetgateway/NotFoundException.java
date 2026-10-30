package cz.hospodskej.eetgateway;

import java.util.Map;

/** 404: no such record. */
public class NotFoundException extends ApiException {
  private static final long serialVersionUID = 1L;

  public NotFoundException(int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
