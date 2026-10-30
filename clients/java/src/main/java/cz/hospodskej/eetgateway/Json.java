package cz.hospodskej.eetgateway;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON reader and writer, so the client needs no library. Objects are {@code Map<String,
 * Object>}, arrays {@code List<Object>}, numbers {@code Long} or {@code Double}.
 */
final class Json {
  private Json() {}

  /** Thrown for text that is not JSON. */
  static final class ParseException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    ParseException(String message) {
      super(message);
    }
  }

  // --- reading ------------------------------------------------------------------------------

  static Object parse(String text) {
    Reader reader = new Reader(text);
    reader.skipSpace();
    Object value = reader.value();
    reader.skipSpace();
    if (!reader.atEnd()) throw reader.error("unexpected data after the value");
    return value;
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> object(Object value) {
    return value instanceof Map ? (Map<String, Object>) value : null;
  }

  @SuppressWarnings("unchecked")
  static List<Object> array(Object value) {
    return value instanceof List ? (List<Object>) value : null;
  }

  /** The member as an object; a missing member or JSON null is {@code null}. */
  static Map<String, Object> obj(Map<String, Object> o, String key) {
    return object(o.get(key));
  }

  static List<Map<String, Object>> objects(Map<String, Object> o, String key) {
    List<Object> items = array(o.get(key));
    List<Map<String, Object>> out = new ArrayList<>();
    if (items != null) {
      for (Object item : items) {
        Map<String, Object> m = object(item);
        if (m != null) out.add(m);
      }
    }
    return out;
  }

  static String str(Map<String, Object> o, String key) {
    Object v = o.get(key);
    return v == null ? null : v.toString();
  }

  static Integer integer(Map<String, Object> o, String key) {
    Object v = o.get(key);
    return v instanceof Number ? Integer.valueOf(((Number) v).intValue()) : null;
  }

  static Double number(Map<String, Object> o, String key) {
    Object v = o.get(key);
    return v instanceof Number ? Double.valueOf(((Number) v).doubleValue()) : null;
  }

  static Boolean bool(Map<String, Object> o, String key) {
    Object v = o.get(key);
    return v instanceof Boolean ? (Boolean) v : null;
  }

  private static Object required(Map<String, Object> o, String key) {
    Object v = o.get(key);
    if (v == null) throw new ParseException("the field \"" + key + "\" is missing");
    return v;
  }

  static String rstr(Map<String, Object> o, String key) {
    return required(o, key).toString();
  }

  static int rint(Map<String, Object> o, String key) {
    Object v = required(o, key);
    if (!(v instanceof Number)) throw new ParseException("the field \"" + key + "\" is not a number");
    return ((Number) v).intValue();
  }

  static double rnum(Map<String, Object> o, String key) {
    Object v = required(o, key);
    if (!(v instanceof Number)) throw new ParseException("the field \"" + key + "\" is not a number");
    return ((Number) v).doubleValue();
  }

  static boolean rbool(Map<String, Object> o, String key) {
    Object v = required(o, key);
    if (!(v instanceof Boolean)) throw new ParseException("the field \"" + key + "\" is not a boolean");
    return (Boolean) v;
  }

  /** The member as an object; the field must be there. */
  static Map<String, Object> robj(Map<String, Object> o, String key) {
    Map<String, Object> m = object(required(o, key));
    if (m == null) throw new ParseException("the field \"" + key + "\" is not an object");
    return m;
  }

  private static final class Reader {
    private final String s;
    private int i;

    Reader(String s) {
      this.s = s;
    }

    boolean atEnd() {
      return i >= s.length();
    }

    ParseException error(String message) {
      return new ParseException(message + " at position " + i);
    }

    void skipSpace() {
      while (i < s.length()) {
        char c = s.charAt(i);
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
        else break;
      }
    }

    Object value() {
      if (atEnd()) throw error("unexpected end");
      char c = s.charAt(i);
      switch (c) {
        case '{':
          return readObject();
        case '[':
          return readArray();
        case '"':
          return readString();
        case 't':
          return literal("true", Boolean.TRUE);
        case 'f':
          return literal("false", Boolean.FALSE);
        case 'n':
          return literal("null", null);
        default:
          if (c == '-' || (c >= '0' && c <= '9')) return readNumber();
          throw error("unexpected character '" + c + "'");
      }
    }

    private Object literal(String word, Object result) {
      if (!s.startsWith(word, i)) throw error("invalid literal");
      i += word.length();
      return result;
    }

    private Map<String, Object> readObject() {
      Map<String, Object> out = new LinkedHashMap<>();
      i++; // {
      skipSpace();
      if (peek() == '}') {
        i++;
        return out;
      }
      while (true) {
        skipSpace();
        if (peek() != '"') throw error("object key expected");
        String key = readString();
        skipSpace();
        if (peek() != ':') throw error("':' expected");
        i++;
        skipSpace();
        out.put(key, value());
        skipSpace();
        char c = peek();
        i++;
        if (c == '}') return out;
        if (c != ',') throw error("',' or '}' expected");
      }
    }

    private List<Object> readArray() {
      List<Object> out = new ArrayList<>();
      i++; // [
      skipSpace();
      if (peek() == ']') {
        i++;
        return out;
      }
      while (true) {
        skipSpace();
        out.add(value());
        skipSpace();
        char c = peek();
        i++;
        if (c == ']') return out;
        if (c != ',') throw error("',' or ']' expected");
      }
    }

    private char peek() {
      if (atEnd()) throw error("unexpected end");
      return s.charAt(i);
    }

    private String readString() {
      i++; // opening quote
      StringBuilder sb = new StringBuilder();
      while (true) {
        if (atEnd()) throw error("unterminated string");
        char c = s.charAt(i++);
        if (c == '"') return sb.toString();
        if (c != '\\') {
          sb.append(c);
          continue;
        }
        if (atEnd()) throw error("unterminated string");
        char e = s.charAt(i++);
        switch (e) {
          case '"':
          case '\\':
          case '/':
            sb.append(e);
            break;
          case 'b':
            sb.append('\b');
            break;
          case 'f':
            sb.append('\f');
            break;
          case 'n':
            sb.append('\n');
            break;
          case 'r':
            sb.append('\r');
            break;
          case 't':
            sb.append('\t');
            break;
          case 'u':
            if (i + 4 > s.length()) throw error("invalid \\u escape");
            try {
              sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
            } catch (NumberFormatException ex) {
              throw error("invalid \\u escape");
            }
            i += 4;
            break;
          default:
            throw error("invalid escape");
        }
      }
    }

    private Object readNumber() {
      int start = i;
      if (s.charAt(i) == '-') i++;
      boolean integral = true;
      while (i < s.length()) {
        char c = s.charAt(i);
        if (c >= '0' && c <= '9') {
          i++;
        } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
          integral = false;
          i++;
        } else {
          break;
        }
      }
      String text = s.substring(start, i);
      try {
        if (integral) {
          try {
            return Long.valueOf(text);
          } catch (NumberFormatException tooLong) {
            return new BigDecimal(text).doubleValue();
          }
        }
        return Double.valueOf(text);
      } catch (NumberFormatException ex) {
        throw error("invalid number");
      }
    }
  }

  // --- writing ------------------------------------------------------------------------------

  /** Serializes maps, lists, strings, numbers, booleans, enums, dates and {@link SaleInput}. */
  static String write(Object value) {
    StringBuilder sb = new StringBuilder();
    write(sb, value);
    return sb.toString();
  }

  private static void write(StringBuilder sb, Object value) {
    if (value == null) {
      sb.append("null");
    } else if (value instanceof SaleInput) {
      write(sb, ((SaleInput) value).toMap());
    } else if (value instanceof Boolean) {
      sb.append(value);
    } else if (value instanceof BigDecimal) {
      sb.append(((BigDecimal) value).toPlainString());
    } else if (value instanceof Number) {
      double d = ((Number) value).doubleValue();
      if (Double.isNaN(d) || Double.isInfinite(d)) {
        throw new IllegalArgumentException("NaN and Infinity are not valid JSON");
      }
      sb.append(value);
    } else if (value instanceof Map) {
      sb.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
        if (!first) sb.append(',');
        first = false;
        quote(sb, String.valueOf(entry.getKey()));
        sb.append(':');
        write(sb, entry.getValue());
      }
      sb.append('}');
    } else if (value instanceof Iterable) {
      sb.append('[');
      boolean first = true;
      for (Object item : (Iterable<?>) value) {
        if (!first) sb.append(',');
        first = false;
        write(sb, item);
      }
      sb.append(']');
    } else if (value instanceof Object[]) {
      write(sb, java.util.Arrays.asList((Object[]) value));
    } else if (value instanceof TemporalAccessor) {
      quote(sb, temporal((TemporalAccessor) value));
    } else {
      quote(sb, value instanceof Enum ? ((Enum<?>) value).name() : value.toString());
    }
  }

  /** ISO 8601, with the offset when the value has one. */
  static String temporal(TemporalAccessor t) {
    if (t instanceof OffsetDateTime) return DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(t);
    if (t instanceof ZonedDateTime) return DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(t);
    if (t instanceof Instant) return DateTimeFormatter.ISO_INSTANT.format(t);
    if (t instanceof LocalDateTime) return DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(t);
    if (t instanceof LocalDate) return DateTimeFormatter.ISO_LOCAL_DATE.format(t);
    return t.toString();
  }

  private static void quote(StringBuilder sb, String text) {
    sb.append('"');
    for (int k = 0; k < text.length(); k++) {
      char c = text.charAt(k);
      switch (c) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        default:
          if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
          else sb.append(c);
      }
    }
    sb.append('"');
  }
}
