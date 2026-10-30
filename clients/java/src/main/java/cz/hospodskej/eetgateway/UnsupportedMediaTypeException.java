package cz.hospodskej.eetgateway;

import java.util.Map;

/** 415: the Content-Type is not supported by the endpoint. */
public class UnsupportedMediaTypeException extends ApiException {
  private static final long serialVersionUID = 1L;

  public UnsupportedMediaTypeException(
      int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
