package cz.hospodskej.eetgateway;

import java.util.Optional;

/** {@code SaleResult.status}. A status this library does not know yet stays a plain string. */
public enum SaleStatus {
  /** EET registered the sale; {@code pok} is set. */
  ACCEPTED("accepted"),
  /** Verification mode: EET checked the message and registered nothing. */
  VERIFICATION_OK("verification_ok"),
  /** EET answered with an error ({@code code}, {@code message}). */
  REJECTED("rejected"),
  /** Stored, not sent yet; the gateway keeps trying. */
  QUEUED("queued"),
  /** Sent, no answer; the gateway resends safely. */
  UNCERTAIN("uncertain"),
  /** Failed the local check ({@code issues}); nothing was sent. */
  INVALID("invalid");

  private final String value;

  SaleStatus(String value) {
    this.value = value;
  }

  /** The status as it is on the wire. */
  public String value() {
    return value;
  }

  @Override
  public String toString() {
    return value;
  }

  /** The status for a wire value, empty for one this library does not know. */
  public static Optional<SaleStatus> of(String value) {
    for (SaleStatus status : values()) {
      if (status.value.equals(value)) return Optional.of(status);
    }
    return Optional.empty();
  }
}
