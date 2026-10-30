package cz.hospodskej.eetgateway;

import java.util.Map;

/** 413: the body is over the gateway limit (64 KiB a sale, 10 MiB a batch). */
public class PayloadTooLargeException extends ApiException {
  private static final long serialVersionUID = 1L;

  public PayloadTooLargeException(
      int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
