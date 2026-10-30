package cz.hospodskej.eetgateway;

import java.util.Map;

/** 422 with an error body, e.g. {@code single_sale_expected} (a batch sent to submitSale). */
public class UnprocessableException extends ApiException {
  private static final long serialVersionUID = 1L;

  public UnprocessableException(
      int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
