package cz.hospodskej.eetgateway;

/** The gateway did not answer within the client timeout. */
public class RequestTimeoutException extends TransportException {
  private static final long serialVersionUID = 1L;

  public RequestTimeoutException(String message, Throwable cause) {
    super(message, cause);
  }
}
