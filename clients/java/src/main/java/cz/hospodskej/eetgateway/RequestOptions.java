package cz.hospodskej.eetgateway;

/**
 * Options of a submit or validate call. All are optional; {@code validateSales} uses only {@code
 * verify} and {@code register}.
 *
 * <pre>{@code
 * client.submitSale(sale, new RequestOptions().idempotencyKey("R-1001"));
 * }</pre>
 */
public final class RequestOptions {
  private String idempotencyKey;
  private String mode;
  private Boolean verify;
  private String register;

  /** No options. */
  public static RequestOptions none() {
    return new RequestOptions();
  }

  /**
   * The {@code Idempotency-Key}, 1 to 255 printable ASCII characters; use the receipt number. A
   * repeated call with the same key returns the stored result and never registers a sale twice.
   */
  public RequestOptions idempotencyKey(String value) {
    this.idempotencyKey = value;
    return this;
  }

  /** "sync" (default for a sale; waits for the first attempt) or "async" (answers 202 at once). */
  public RequestOptions mode(String value) {
    this.mode = value;
    return this;
  }

  /** Verification mode: EET checks the message and registers nothing. */
  public RequestOptions verify(boolean value) {
    this.verify = value;
    return this;
  }

  /** The register to use, when the gateway has more than one. */
  public RequestOptions register(String value) {
    this.register = value;
    return this;
  }

  String idempotencyKey() {
    return idempotencyKey;
  }

  String mode() {
    return mode;
  }

  Boolean verify() {
    return verify;
  }

  String register() {
    return register;
  }
}
