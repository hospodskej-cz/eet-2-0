package cz.hospodskej.eetgateway;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One sale as the gateway accepts it. Everything but the two required fields is optional:
 * {@code eic_popl}, {@code id_jednotky} and {@code id_pokl} come from the register configuration.
 *
 * <p>Instead of this class {@link EetGatewayClient#submitSale} also takes a plain {@code Map} with
 * any field the gateway's ingest understands (docs/INGEST.md).
 *
 * <pre>{@code
 * SaleInput.of(OffsetDateTime.now(), new BigDecimal("123.50")).poradCis("R-1001")
 * }</pre>
 */
public final class SaleInput {
  private final Map<String, Object> fields = new LinkedHashMap<>();

  private SaleInput() {}

  /**
   * Creates a sale.
   *
   * @param datTrzby when the sale happened: an ISO 8601 string, or an {@code OffsetDateTime}, {@code
   *     ZonedDateTime} or {@code Instant}; a {@code LocalDateTime} is read in the register's time
   *     zone
   * @param celkTrzba the total: a string ("123.50"), or a {@code BigDecimal}, {@code double} or
   *     {@code float} formatted to 2 places
   */
  public static SaleInput of(Object datTrzby, Object celkTrzba) {
    SaleInput sale = new SaleInput();
    sale.fields.put("dat_trzby", datTrzby);
    sale.fields.put("celk_trzba", amount(celkTrzba));
    return sale;
  }

  /** Receipt number; also the natural {@code Idempotency-Key}. */
  public SaleInput poradCis(Object value) {
    return with("porad_cis", value);
  }

  public SaleInput eicPopl(String value) {
    return with("eic_popl", value);
  }

  public SaleInput eicPoverujiciho(String value) {
    return with("eic_poverujiciho", value);
  }

  public SaleInput povereniViceOpl(boolean value) {
    return with("povereni_vice_popl", value);
  }

  public SaleInput idJednotky(Object value) {
    return with("id_jednotky", value);
  }

  public SaleInput idPokl(String value) {
    return with("id_pokl", value);
  }

  public SaleInput urcenoCerpZuct(Object amount) {
    return with("urceno_cerp_zuct", amount(amount));
  }

  public SaleInput cerpZuct(Object amount) {
    return with("cerp_zuct", amount(amount));
  }

  /** Verification mode for this sale: EET checks the message and registers nothing. */
  public SaleInput overeni(boolean value) {
    return with("overeni", value);
  }

  public SaleInput prvniZaslani(boolean value) {
    return with("prvni_zaslani", value);
  }

  /** The register this sale belongs to, when the gateway has more than one. */
  public SaleInput register(String value) {
    return with("register", value);
  }

  /** Any further field the ingest understands. */
  public SaleInput with(String name, Object value) {
    if (value == null) fields.remove(name);
    else fields.put(name, value);
    return this;
  }

  /** The fields as they go over the wire. */
  public Map<String, Object> toMap() {
    return new LinkedHashMap<>(fields);
  }

  /** BigDecimal, double and float become a two-place string ("123.50"); everything else passes. */
  static Object amount(Object value) {
    if (value instanceof BigDecimal) {
      return ((BigDecimal) value).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
    if (value instanceof Double || value instanceof Float) {
      return BigDecimal.valueOf(((Number) value).doubleValue())
          .setScale(2, RoundingMode.HALF_UP)
          .toPlainString();
    }
    return value;
  }
}
