package cz.hospodskej.eetgateway;

import java.util.Map;

/**
 * 409: the record is final ({@code not_retryable}), being sent ({@code in_progress}) or its
 * register is gone ({@code unknown_register}).
 */
public class ConflictException extends ApiException {
  private static final long serialVersionUID = 1L;

  public ConflictException(int status, String code, String detail, Map<String, String> headers) {
    super(status, code, detail, headers);
  }
}
