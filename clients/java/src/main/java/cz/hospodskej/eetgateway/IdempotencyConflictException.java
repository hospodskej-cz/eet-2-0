package cz.hospodskej.eetgateway;

import java.util.Map;

/** 409: the Idempotency-Key was already used for a different sale. Nothing was sent. */
public class IdempotencyConflictException extends ConflictException {
  private static final long serialVersionUID = 1L;

  private final transient SaleResult result;

  public IdempotencyConflictException(SaleResult result, Map<String, String> headers) {
    super(
        409,
        result.issues().isEmpty() ? "idempotency_conflict" : result.issues().get(0).code(),
        result.issues().isEmpty()
            ? "Idempotency-Key was used for another sale."
            : result.issues().get(0).message(),
        headers);
    this.result = result;
  }

  /** The body of the 409 answer. */
  public SaleResult result() {
    return result;
  }
}
