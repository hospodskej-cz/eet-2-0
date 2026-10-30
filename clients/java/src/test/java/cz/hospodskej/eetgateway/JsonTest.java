package cz.hospodskej.eetgateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class JsonTest {
  @Test
  void parsesEveryValueType() {
    Map<String, Object> o =
        Json.object(Json.parse(" {\"a\": [1, 2.5, -3e2, true, false, null, \"x\"], \"b\": {}, \"c\": \"\\u00e1\\n\\\"\" } "));
    assertEquals(List.of(1L, 2.5, -300.0, true, false), Json.array(o.get("a")).subList(0, 5));
    assertNull(Json.array(o.get("a")).get(5));
    assertEquals("x", Json.array(o.get("a")).get(6));
    assertTrue(Json.obj(o, "b").isEmpty());
    assertEquals("á\n\"", o.get("c"));
  }

  @Test
  void parseRejectsWhatIsNotJson() {
    for (String bad : new String[] {"", "{", "[1,]", "{\"a\" 1}", "nul", "\"abc", "1 2", "{\"a\":1,}", "tru"}) {
      assertThrows(Json.ParseException.class, () -> Json.parse(bad), bad);
    }
  }

  @Test
  void writeEscapesAndFormats() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("s", "a\"b\\c\n\u0001é");
    m.put("n", 5);
    m.put("d", new BigDecimal("1.50"));
    m.put("l", List.of(true, "x"));
    m.put("t", Instant.parse("2027-01-05T11:00:00Z"));
    m.put("local", LocalDateTime.parse("2027-01-05T12:00:00"));
    m.put("none", null);
    assertEquals(
        "{\"s\":\"a\\\"b\\\\c\\n\\u0001é\",\"n\":5,\"d\":1.50,\"l\":[true,\"x\"],\"t\":\"2027-01-05T11:00:00Z\",\"local\":\"2027-01-05T12:00:00\",\"none\":null}",
        Json.write(m));
  }

  @Test
  void writtenJsonParsesBack() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("text", "line\nbreak \"quoted\" \\ é €");
    m.put("list", List.of(1, 2, 3));
    assertEquals(Json.parse(Json.write(m)), Json.parse(Json.write(Json.parse(Json.write(m)))));
    assertEquals("line\nbreak \"quoted\" \\ é €", Json.object(Json.parse(Json.write(m))).get("text"));
  }

  @Test
  void saleInputFormatsAmountsToTwoPlaces() {
    Map<String, Object> m =
        SaleInput.of("2027-01-05T12:00:00+01:00", 99.5).cerpZuct(new BigDecimal("1")).povereniViceOpl(true).toMap();
    assertEquals("99.50", m.get("celk_trzba"));
    assertEquals("1.00", m.get("cerp_zuct"));
    assertEquals(true, m.get("povereni_vice_popl"));
  }
}
