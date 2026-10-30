package cz.hospodskej.eetgateway;

/** No HTTP answer was received. */
public class TransportException extends EetGatewayException {
  private static final long serialVersionUID = 1L;

  public TransportException(String message, Throwable cause) {
    super(message, cause);
  }
}
