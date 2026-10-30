package cz.hospodskej.eetgateway;

import java.util.Map;

/**
 * The EET {@code <Data>} stored for a sale; every attempt sends exactly this. The optional parts
 * ({@code eicPoverujiciho}, {@code povereniViceOpl}, {@code urcenoCerpZuct}, {@code cerpZuct}) are
 * null when absent.
 */
public record SaleData(
    String eicPopl,
    String idJednotky,
    String idPokl,
    String poradCis,
    String datTrzby,
    String celkTrzba,
    String eicPoverujiciho,
    Boolean povereniViceOpl,
    String urcenoCerpZuct,
    String cerpZuct) {

  static SaleData fromJson(Map<String, Object> d) {
    return new SaleData(
        Json.rstr(d, "eic_popl"),
        Json.rstr(d, "id_jednotky"),
        Json.rstr(d, "id_pokl"),
        Json.rstr(d, "porad_cis"),
        Json.rstr(d, "dat_trzby"),
        Json.rstr(d, "celk_trzba"),
        Json.str(d, "eic_poverujiciho"),
        Json.bool(d, "povereni_vice_popl"),
        Json.str(d, "urceno_cerp_zuct"),
        Json.str(d, "cerp_zuct"));
  }
}
