package cz.hospodskej.eetgateway;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.regex.Pattern;

/**
 * Client for one EET Gateway: {@code java.net.http} from the JDK, no other dependencies.
 *
 * <pre>{@code
 * EetGatewayClient client =
 *     EetGatewayClient.builder("http://localhost:8080").apiKey(System.getenv("EET_API_KEY")).build();
 * SaleResult result =
 *     client.submitSale(
 *         SaleInput.of(OffsetDateTime.now(), new BigDecimal("123.50")).poradCis("R-1001"),
 *         new RequestOptions().idempotencyKey("R-1001"));
 * if (result.isPending()) result = client.waitForSale(result);
 * }</pre>
 *
 * The API key may be null only for a gateway started with {@code --dev}. The timeout bounds every
 * request; a synchronous submit waits for EET, up to the register's {@code timeoutMs} (10 s by
 * default), so keep it above that. The client never retries on its own: repeat a submit yourself
 * with the same idempotency key. It is thread-safe.
 */
public final class EetGatewayClient {
  /** The version of this library. */
  public static final String VERSION = "0.1.0";

  private static final String JSON = "application/json";
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[\\x21-\\x7e]{1,255}");

  /**
   * Every operation of docs/openapi.json: operationId to HTTP method and path. The methods below
   * send requests through this table, and scripts/gen-clients.ts fails CI when it falls behind the
   * OpenAPI document.
   */
  private static final Map<String, String[]> OPERATIONS = new LinkedHashMap<>();

  private static void op(String id, String method, String path) {
    OPERATIONS.put(id, new String[] {method, path});
  }

  static {
    op("submitSale", "POST", "/v1/sales");
    op("submitBatch", "POST", "/v1/sales/batch");
    op("getSale", "GET", "/v1/sales/{id}");
    op("getSaleAttempts", "GET", "/v1/sales/{id}/attempts");
    op("retrySale", "POST", "/v1/sales/{id}/retry");
    op("listQueue", "GET", "/v1/queue");
    op("listRegisters", "GET", "/v1/registers");
    op("validateSales", "POST", "/v1/validate");
    op("health", "GET", "/health");
    op("openapi", "GET", "/openapi.json");
    op("docs", "GET", "/docs");
  }

  /** operationId to {@code "METHOD /path"}, for the tests. */
  static Map<String, String> operations() {
    Map<String, String> out = new LinkedHashMap<>();
    OPERATIONS.forEach((id, mp) -> out.put(id, mp[0] + " " + mp[1]));
    return out;
  }

  private final String baseUrl;
  private final String apiKey;
  private final Duration timeout;
  private final String userAgent;
  private final HttpClient http;

  private EetGatewayClient(Builder b) {
    this.baseUrl = b.baseUrl.replaceAll("/+$", "");
    this.apiKey = b.apiKey;
    this.timeout = b.timeout;
    this.userAgent = b.userAgent != null ? b.userAgent : "eet-gateway-client-java/" + VERSION;
    this.http =
        b.http != null
            ? b.http
            : HttpClient.newBuilder()
                .connectTimeout(b.timeout)
                .followRedirects(HttpClient.Redirect.NEVER) // a redirect would replay POSTs as GETs
                .build();
  }

  /** Starts a client for the gateway at {@code baseUrl}, e.g. "http://localhost:8080". */
  public static Builder builder(String baseUrl) {
    return new Builder(baseUrl);
  }

  /** Builds an {@link EetGatewayClient}. */
  public static final class Builder {
    private final String baseUrl;
    private String apiKey;
    private Duration timeout = Duration.ofSeconds(30);
    private String userAgent;
    private HttpClient http;

    private Builder(String baseUrl) {
      if (baseUrl == null || !(baseUrl.startsWith("http://") || baseUrl.startsWith("https://"))) {
        throw new IllegalArgumentException("baseUrl must start with http:// or https://");
      }
      this.baseUrl = baseUrl;
    }

    /** The API key, sent as a bearer token. Null only for a gateway started with --dev. */
    public Builder apiKey(String value) {
      this.apiKey = value;
      return this;
    }

    /** Bounds every request (default 30 s). */
    public Builder timeout(Duration value) {
      this.timeout = value;
      return this;
    }

    public Builder userAgent(String value) {
      this.userAgent = value;
      return this;
    }

    /**
     * Your own {@link HttpClient} (proxy, TLS, executor). It must not follow redirects: a gateway
     * does not redirect, and following one would replay a POST as a GET and leak the key.
     */
    public Builder httpClient(HttpClient value) {
      this.http = value;
      return this;
    }

    public EetGatewayClient build() {
      return new EetGatewayClient(this);
    }
  }

  // --- sales ------------------------------------------------------------------------------

  /** {@link #submitSale(Object, RequestOptions)} without options. */
  public SaleResult submitSale(Object sale) {
    return submitSale(sale, RequestOptions.none());
  }

  /**
   * POST /v1/sales: validates, stores and sends one sale.
   *
   * <p>Returns the {@link SaleResult} for HTTP 200 ({@code accepted}, {@code verification_ok},
   * {@code rejected}), 202 ({@code queued}, {@code uncertain}: use {@link #waitForSale}) and 422
   * ({@code invalid}: see {@code issues()}, nothing was sent). Throws {@link
   * IdempotencyConflictException} on 409.
   *
   * @param sale a {@link SaleInput} or a {@code Map} with the EET fields
   */
  public SaleResult submitSale(Object sale, RequestOptions options) {
    return submitSaleRaw(Json.write(sale), JSON, options);
  }

  /** {@link #submitSale} for a body you already serialized: XML ({@code <Data>}, {@code <Trzba>}), JSON, form. */
  public SaleResult submitSaleRaw(String body, String contentType, RequestOptions options) {
    return submitSaleRaw(body.getBytes(StandardCharsets.UTF_8), contentType, options);
  }

  public SaleResult submitSaleRaw(byte[] body, String contentType, RequestOptions options) {
    RequestOptions o = options == null ? RequestOptions.none() : options;
    Response response =
        send(
            "submitSale",
            null,
            query("mode", o.mode(), "verify", o.verify(), "register", o.register()),
            body,
            contentType,
            o.idempotencyKey(),
            true);
    return saleResult(response, 200, 202, 422);
  }

  /** {@link #submitBatch(Iterable, RequestOptions)} without options. */
  public BatchResult submitBatch(Iterable<?> sales) {
    return submitBatch(sales, RequestOptions.none());
  }

  /**
   * POST /v1/sales/batch: resending after an outage or migration (default mode: async).
   *
   * <p>Each row is stored and sent on its own and keyed {@code <idempotencyKey>:<row>}. HTTP 200 and
   * 422 (the source could not be read: {@code issues()}) both return a {@link BatchResult}.
   */
  public BatchResult submitBatch(Iterable<?> sales, RequestOptions options) {
    return submitBatchRaw(Json.write(sales), JSON, options);
  }

  /** {@link #submitBatch} for NDJSON ({@code application/x-ndjson}), CSV ({@code text/csv}) or XML. */
  public BatchResult submitBatchRaw(String body, String contentType, RequestOptions options) {
    return submitBatchRaw(body.getBytes(StandardCharsets.UTF_8), contentType, options);
  }

  public BatchResult submitBatchRaw(byte[] body, String contentType, RequestOptions options) {
    RequestOptions o = options == null ? RequestOptions.none() : options;
    Response response =
        send(
            "submitBatch",
            null,
            query("mode", o.mode(), "verify", o.verify(), "register", o.register()),
            body,
            contentType,
            o.idempotencyKey(),
            true);
    return BatchResult.fromJson(object(response, 200, 422));
  }

  /** GET /v1/sales/{id}: the current state. Throws {@link NotFoundException}. */
  public SaleResult getSale(String saleId) {
    Response response = send("getSale", Map.of("id", saleId), null, null, null, null, true);
    return model(response, () -> SaleResult.fromJson(object(response, 200), null, false));
  }

  /** GET /v1/sales/{id}/attempts: every message sent for the sale, oldest first. */
  public List<Attempt> getSaleAttempts(String saleId) {
    Response response = send("getSaleAttempts", Map.of("id", saleId), null, null, null, null, true);
    return model(
        response,
        () -> {
          List<Attempt> out = new ArrayList<>();
          for (Map<String, Object> a : Json.objects(object(response, 200), "items")) {
            out.add(Attempt.fromJson(a));
          }
          return Collections.unmodifiableList(out);
        });
  }

  /**
   * POST /v1/sales/{id}/retry: send a {@code queued}, {@code uncertain} or {@code rejected} sale
   * now. Throws {@link ConflictException} ({@code not_retryable}, {@code in_progress}, {@code
   * unknown_register}).
   */
  public SaleResult retrySale(String saleId) {
    Response response = send("retrySale", Map.of("id", saleId), null, null, null, null, true);
    return saleResult(response, 200, 202);
  }

  /** {@link #waitForSale(SaleResult, Duration, Duration)} with 30 s and a 1 s interval. */
  public SaleResult waitForSale(SaleResult sale) {
    return waitForSale(sale, Duration.ofSeconds(30), Duration.ofSeconds(1));
  }

  /** {@link #waitForSale(String, Duration, Duration)} with 30 s and a 1 s interval. */
  public SaleResult waitForSale(String saleId) {
    return waitForSale(saleId, Duration.ofSeconds(30), Duration.ofSeconds(1));
  }

  /** Polls until the sale is decided; a final result is returned at once. */
  public SaleResult waitForSale(SaleResult sale, Duration timeout, Duration interval) {
    if (sale.isFinal() || sale.id() == null) return sale;
    return poll(sale.id(), sale, timeout, interval);
  }

  /**
   * Polls {@link #getSale} until the sale is neither {@code queued} nor {@code uncertain}. Gives
   * up after {@code timeout} and returns the last state, so check {@code isPending()}: the gateway
   * keeps resending in the background, you can ask again later.
   */
  public SaleResult waitForSale(String saleId, Duration timeout, Duration interval) {
    return poll(saleId, getSale(saleId), timeout, interval);
  }

  private SaleResult poll(String saleId, SaleResult first, Duration timeout, Duration interval) {
    SaleResult current = first;
    long deadline = System.nanoTime() + timeout.toNanos();
    while (current.isPending() && System.nanoTime() < deadline) {
      try {
        Thread.sleep(interval.toMillis());
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return current;
      }
      current = getSale(saleId);
    }
    return current;
  }

  // --- queue, registers, validation -------------------------------------------------------

  /** GET /v1/queue: one page, newest first (limit 1 to 500, default 50). */
  public QueuePage listQueue(QueueFilter filter) {
    QueueFilter f = filter == null ? QueueFilter.all() : filter;
    Response response =
        send(
            "listQueue",
            null,
            query(
                "status", f.statusParam(),
                "register", f.register(),
                "from", f.from(),
                "to", f.to(),
                "overdue", f.overdue(),
                "limit", f.limit(),
                "cursor", f.cursor()),
            null,
            null,
            null,
            true);
    return model(response, () -> QueuePage.fromJson(object(response, 200)));
  }

  /** Every sale matching the filter, following {@code nextCursor} page by page (lazily). */
  public Iterable<SaleResult> iterateQueue(QueueFilter filter) {
    QueueFilter base = filter == null ? QueueFilter.all() : filter;
    return () ->
        new Iterator<SaleResult>() {
          private Iterator<SaleResult> page = Collections.emptyIterator();
          private String cursor;
          private boolean started;
          private boolean done;

          private void fill() {
            while (!page.hasNext() && !done) {
              QueuePage next = listQueue(base.copyWithCursor(started ? cursor : null));
              started = true;
              page = next.items().iterator();
              cursor = next.nextCursor();
              if (cursor == null || cursor.isEmpty()) done = true;
            }
          }

          @Override
          public boolean hasNext() {
            fill();
            return page.hasNext();
          }

          @Override
          public SaleResult next() {
            if (!hasNext()) throw new NoSuchElementException();
            return page.next();
          }
        };
  }

  /** GET /v1/registers: registers with certificate validity ({@code daysLeft}, {@code expiresSoon}). */
  public List<Register> listRegisters() {
    Response response = send("listRegisters", null, null, null, null, null, true);
    return model(
        response,
        () -> {
          List<Register> out = new ArrayList<>();
          for (Map<String, Object> r : Json.objects(object(response, 200), "items")) {
            out.add(Register.fromJson(r));
          }
          return Collections.unmodifiableList(out);
        });
  }

  /** POST /v1/validate: the same ingest as a submit, but nothing is stored or sent. */
  public ValidationBatch validateSales(Iterable<?> sales, RequestOptions options) {
    return validateSalesRaw(Json.write(sales), JSON, options);
  }

  /** {@link #validateSales} for NDJSON, CSV, XML or a single JSON object. */
  public ValidationBatch validateSalesRaw(String body, String contentType, RequestOptions options) {
    return validateSalesRaw(body.getBytes(StandardCharsets.UTF_8), contentType, options);
  }

  public ValidationBatch validateSalesRaw(byte[] body, String contentType, RequestOptions options) {
    RequestOptions o = options == null ? RequestOptions.none() : options;
    Response response =
        send(
            "validateSales",
            null,
            query("verify", o.verify(), "register", o.register()),
            body,
            contentType,
            null,
            true);
    return model(response, () -> ValidationBatch.fromJson(object(response, 200, 422)));
  }

  // --- system -----------------------------------------------------------------------------

  /** GET /health (public). A degraded gateway (HTTP 503) is returned, not thrown. */
  public Health health() {
    return health(false);
  }

  /**
   * GET /health (public).
   *
   * @param checkEet also probe every EET endpoint (the gateway caches the probe for 60 s)
   */
  public Health health(boolean checkEet) {
    Response response =
        send("health", null, query("eet", checkEet ? Boolean.TRUE : null), null, null, null, false);
    return model(response, () -> Health.fromJson(object(response, 200, 503)));
  }

  /** GET /openapi.json (public): the OpenAPI 3.1 document of the running gateway. */
  public Map<String, Object> getOpenApi() {
    Response response = send("openapi", null, null, null, null, null, false);
    return object(response, 200);
  }

  /** GET /docs (public): the interactive API reference as HTML. */
  public String getDocs() {
    Response response = send("docs", null, null, null, null, null, false);
    if (response.status != 200) throw error(response);
    return new String(response.body, StandardCharsets.UTF_8);
  }

  // --- internals --------------------------------------------------------------------------

  private static final class Response {
    final int status;
    final Map<String, String> headers;
    final byte[] body;

    Response(int status, Map<String, String> headers, byte[] body) {
      this.status = status;
      this.headers = headers;
      this.body = body;
    }
  }

  /** Name, value pairs; null values are left out. */
  private static Map<String, Object> query(Object... pairs) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      if (pairs[i + 1] != null) out.put((String) pairs[i], pairs[i + 1]);
    }
    return out;
  }

  private static String queryValue(Object value) {
    if (value instanceof TemporalAccessor) return Json.temporal((TemporalAccessor) value);
    return String.valueOf(value);
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private Response send(
      String operation,
      Map<String, String> path,
      Map<String, Object> query,
      byte[] body,
      String contentType,
      String idempotencyKey,
      boolean authorize) {
    String[] mp = OPERATIONS.get(operation);
    String method = mp[0];
    String url = baseUrl + mp[1];
    if (path != null) {
      for (Map.Entry<String, String> e : path.entrySet()) {
        url = url.replace("{" + e.getKey() + "}", encode(e.getValue()));
      }
    }
    if (query != null && !query.isEmpty()) {
      StringBuilder sb = new StringBuilder(url).append('?');
      boolean first = true;
      for (Map.Entry<String, Object> e : query.entrySet()) {
        if (!first) sb.append('&');
        first = false;
        sb.append(encode(e.getKey())).append('=').append(encode(queryValue(e.getValue())));
      }
      url = sb.toString();
    }
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create(url))
            .timeout(timeout)
            .header("Accept", JSON)
            .header("User-Agent", userAgent);
    if (authorize && apiKey != null && !apiKey.isEmpty()) {
      request.header("Authorization", "Bearer " + apiKey);
    }
    if (idempotencyKey != null) {
      if (!IDEMPOTENCY_KEY.matcher(idempotencyKey).matches()) {
        throw new IllegalArgumentException(
            "idempotencyKey must be 1-255 printable ASCII characters");
      }
      request.header("Idempotency-Key", idempotencyKey);
    }
    if (body != null) {
      request.header("Content-Type", contentType != null ? contentType : JSON);
      request.method(method, HttpRequest.BodyPublishers.ofByteArray(body));
    } else if ("POST".equals(method)) {
      request.POST(HttpRequest.BodyPublishers.noBody());
    } else {
      request.GET();
    }
    try {
      HttpResponse<byte[]> raw = http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
      Map<String, String> headers = new LinkedHashMap<>();
      raw.headers()
          .map()
          .forEach(
              (name, values) -> {
                if (!values.isEmpty()) headers.put(name.toLowerCase(Locale.ROOT), values.get(0));
              });
      return new Response(raw.statusCode(), headers, raw.body());
    } catch (HttpTimeoutException e) {
      throw new RequestTimeoutException(
          method + " " + url + " timed out after " + timeout.toMillis() + " ms", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new TransportException(method + " " + url + " was interrupted", e);
    } catch (IOException e) {
      throw new TransportException(method + " " + url + " failed: " + e, e);
    }
  }

  /** Runs the model builder; a field the documented shape lacks becomes an InvalidResponseException. */
  private static <T> T model(Response response, java.util.function.Supplier<T> build) {
    try {
      return build.get();
    } catch (Json.ParseException e) {
      throw new InvalidResponseException(
          "HTTP " + response.status + ": " + e.getMessage(), response.status, e);
    }
  }

  private static boolean accepts(int status, int[] accept) {
    for (int a : accept) {
      if (a == status) return true;
    }
    return false;
  }

  private static Object decode(Response response) {
    try {
      return Json.parse(new String(response.body, StandardCharsets.UTF_8));
    } catch (Json.ParseException e) {
      throw new InvalidResponseException(
          "HTTP " + response.status + ": the body is not JSON", response.status, e);
    }
  }

  /** The body as a JSON object when the status is one of {@code accept}, else the API error. */
  private Map<String, Object> object(Response response, int... accept) {
    if (!accepts(response.status, accept)) throw error(response);
    Map<String, Object> body = Json.object(decode(response));
    if (body == null) {
      throw new InvalidResponseException(
          "HTTP " + response.status + ": the body is not a JSON object", response.status, null);
    }
    return body;
  }

  private SaleResult saleResult(Response response, int... accept) {
    Map<String, Object> body = null;
    if (response.body.length > 0) {
      try {
        body = Json.object(Json.parse(new String(response.body, StandardCharsets.UTF_8)));
      } catch (Json.ParseException e) {
        if (accepts(response.status, accept)) {
          throw new InvalidResponseException(
              "HTTP " + response.status + ": the body is not JSON", response.status, e);
        }
      }
    }
    final Map<String, Object> sale = body;
    boolean isSale = sale != null && sale.containsKey("status");
    if (response.status == 409 && isSale) {
      SaleResult result = model(response, () -> SaleResult.fromJson(sale, null, false));
      throw new IdempotencyConflictException(result, response.headers);
    }
    if (!accepts(response.status, accept) || !isSale) throw error(response);
    String replayed = response.headers.getOrDefault("idempotent-replayed", "");
    return model(
        response,
        () ->
            SaleResult.fromJson(
                sale, response.headers.get("location"), "true".equalsIgnoreCase(replayed)));
  }

  private ApiException error(Response response) {
    String code = "http_error";
    String message = "unexpected HTTP " + response.status;
    Map<String, Object> body = null;
    String text = new String(response.body, StandardCharsets.UTF_8).trim();
    try {
      body = Json.object(Json.parse(text));
    } catch (Json.ParseException e) {
      if (!text.isEmpty()) message = text.substring(0, Math.min(text.length(), 200));
    }
    if (body != null) {
      Map<String, Object> err = Json.obj(body, "error");
      List<Map<String, Object>> issues = Json.objects(body, "issues");
      if (err != null) {
        if (err.get("code") != null) code = err.get("code").toString();
        if (err.get("message") != null) message = err.get("message").toString();
      } else if (!issues.isEmpty()) {
        Map<String, Object> first = issues.get(0);
        if (first.get("code") != null) code = first.get("code").toString();
        if (first.get("message") != null) message = first.get("message").toString();
      }
    }
    int status = response.status;
    Map<String, String> h = response.headers;
    switch (status) {
      case 400:
        return new BadRequestException(status, code, message, h);
      case 401:
        return new AuthenticationException(status, code, message, h);
      case 404:
        return new NotFoundException(status, code, message, h);
      case 409:
        return new ConflictException(status, code, message, h);
      case 413:
        return new PayloadTooLargeException(status, code, message, h);
      case 415:
        return new UnsupportedMediaTypeException(status, code, message, h);
      case 422:
        return new UnprocessableException(status, code, message, h);
      default:
        return status >= 500
            ? new ServerException(status, code, message, h)
            : new ApiException(status, code, message, h);
    }
  }
}
