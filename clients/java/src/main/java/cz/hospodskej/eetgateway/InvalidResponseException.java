package cz.hospodskej.eetgateway;

/** The gateway answered with something that is not the documented JSON. */
public class InvalidResponseException extends EetGatewayException {
  private static final long serialVersionUID = 1L;

  private final int status;

  public InvalidResponseException(String message, int status, Throwable cause) {
    super(message, cause);
    this.status = status;
  }

  /** The HTTP status of the answer. */
  public int status() {
    return status;
  }
}
