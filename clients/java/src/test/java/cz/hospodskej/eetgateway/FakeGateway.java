package cz.hospodskej.eetgateway;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** A gateway on a loopback port that answers with the programmed replies, in order. */
final class FakeGateway implements AutoCloseable {
  /** A request as the server saw it; header names are lower case. */
  record Seen(String method, String path, String query, Map<String, String> headers, String body) {}

  private record Reply(int status, String body, Map<String, String> headers, long delayMs) {}

  private final HttpServer server;
  private final Deque<Reply> replies = new ArrayDeque<>();
  final List<Seen> seen = new CopyOnWriteArrayList<>();

  FakeGateway() throws IOException {
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext("/", exchange -> {
      Map<String, String> headers = new LinkedHashMap<>();
      exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(), v.get(0)));
      String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
      seen.add(
          new Seen(
              exchange.getRequestMethod(),
              exchange.getRequestURI().getRawPath(),
              exchange.getRequestURI().getRawQuery(),
              headers,
              body));
      Reply reply;
      synchronized (replies) {
        reply = replies.poll();
      }
      if (reply == null) reply = new Reply(500, "{\"error\":{\"code\":\"no_reply\",\"message\":\"none\"}}", Map.of(), 0);
      if (reply.delayMs() > 0) {
        try {
          Thread.sleep(reply.delayMs());
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
      byte[] out = reply.body().getBytes(StandardCharsets.UTF_8);
      reply.headers().forEach((k, v) -> exchange.getResponseHeaders().add(k, v));
      if (!reply.headers().containsKey("Content-Type")) {
        exchange.getResponseHeaders().add("Content-Type", "application/json");
      }
      exchange.sendResponseHeaders(reply.status(), out.length == 0 ? -1 : out.length);
      if (out.length > 0) {
        try (OutputStream os = exchange.getResponseBody()) {
          os.write(out);
        }
      }
      exchange.close();
    });
    server.start();
  }

  String url() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  /** Queues a reply; {@code headers} are name, value pairs. */
  FakeGateway reply(int status, String body, String... headers) {
    return reply(0, status, body, headers);
  }

  FakeGateway reply(long delayMs, int status, String body, String... headers) {
    Map<String, String> map = new LinkedHashMap<>();
    for (int i = 0; i < headers.length; i += 2) map.put(headers[i], headers[i + 1]);
    synchronized (replies) {
      replies.add(new Reply(status, body, map, delayMs));
    }
    return this;
  }

  Seen last() {
    return seen.get(seen.size() - 1);
  }

  @Override
  public void close() {
    server.stop(0);
  }

  // --- canned bodies ----------------------------------------------------------------------

  static final String DATA =
      "{\"eic_popl\":\"CZ1\",\"id_jednotky\":\"1\",\"id_pokl\":\"P1\",\"porad_cis\":\"R-1001\","
          + "\"dat_trzby\":\"2027-01-05T12:00:00+01:00\",\"celk_trzba\":\"123.50\"}";

  static String sale(String id, String status) {
    return "{\"id\":\"" + id + "\",\"status\":\"" + status + "\",\"attempts\":1,\"register\":\"main\","
        + "\"data\":" + DATA + ",\"warnings\":[]}";
  }

  static String accepted(String id) {
    return "{\"id\":\"" + id + "\",\"status\":\"accepted\",\"pok\":\"POK-1\",\"attempts\":1,"
        + "\"register\":\"main\",\"test\":true,\"data\":" + DATA
        + ",\"warnings\":[{\"code\":7,\"message\":\"rounded\",\"source\":\"ingest\",\"field\":\"celk_trzba\"}]}";
  }
}
