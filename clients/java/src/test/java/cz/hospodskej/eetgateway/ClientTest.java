package cz.hospodskej.eetgateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ClientTest {
  private static EetGatewayClient client(FakeGateway gateway) {
    return EetGatewayClient.builder(gateway.url()).apiKey("secret-key").build();
  }

  private static SaleInput sale() {
    return SaleInput.of(OffsetDateTime.parse("2027-01-05T12:00:00+01:00"), new BigDecimal("123.5"))
        .poradCis("R-1001");
  }

  @Test
  void submitSaleSendsTheDocumentedRequestAndParsesTheAnswer() throws Exception {
    try (FakeGateway gateway =
        new FakeGateway()
            .reply(200, FakeGateway.accepted("s1"), "Location", "/v1/sales/s1", "Idempotent-Replayed", "true")) {
      SaleResult result = client(gateway).submitSale(sale(), new RequestOptions().idempotencyKey("R-1001").mode("sync"));

      FakeGateway.Seen request = gateway.last();
      assertEquals("POST", request.method());
      assertEquals("/v1/sales", request.path());
      assertEquals("mode=sync", request.query());
      assertEquals("Bearer secret-key", request.headers().get("authorization"));
      assertEquals("R-1001", request.headers().get("idempotency-key"));
      assertEquals("application/json", request.headers().get("content-type"));
      assertTrue(request.headers().get("user-agent").startsWith("eet-gateway-client-java/"));
      Map<String, Object> sent = Json.object(Json.parse(request.body()));
      assertEquals("123.50", sent.get("celk_trzba"));
      assertEquals("R-1001", sent.get("porad_cis"));
      assertEquals("2027-01-05T12:00:00+01:00", sent.get("dat_trzby"));

      assertEquals("accepted", result.status());
      assertEquals(SaleStatus.ACCEPTED, result.knownStatus().orElseThrow());
      assertTrue(result.isSuccess());
      assertFalse(result.isPending());
      assertEquals("POK-1", result.pok());
      assertEquals("s1", result.id());
      assertEquals(Boolean.TRUE, result.test());
      assertEquals("CZ1", result.data().eicPopl());
      assertEquals("123.50", result.data().celkTrzba());
      assertNull(result.data().eicPoverujiciho());
      assertEquals(1, result.warnings().size());
      assertEquals("celk_trzba", result.warnings().get(0).field());
      assertEquals("/v1/sales/s1", result.location());
      assertTrue(result.replayed());
    }
  }

  @Test
  void invalidSaleIsAResultNotAnException() throws Exception {
    String body =
        "{\"status\":\"invalid\",\"issues\":[{\"code\":\"missing_field\",\"message\":\"celk_trzba\",\"field\":\"celk_trzba\"}],\"warnings\":[]}";
    try (FakeGateway gateway = new FakeGateway().reply(422, body)) {
      SaleResult result = client(gateway).submitSale(Map.of("porad_cis", "1"));
      assertEquals(SaleStatus.INVALID, result.knownStatus().orElseThrow());
      assertNull(result.id());
      assertEquals("missing_field", result.issues().get(0).code());
      assertTrue(result.isFinal());
    }
  }

  @Test
  void unknownStatusStaysAString() throws Exception {
    try (FakeGateway gateway = new FakeGateway().reply(200, "{\"status\":\"settled\"}")) {
      SaleResult result = client(gateway).submitSale(sale());
      assertEquals("settled", result.status());
      assertTrue(result.knownStatus().isEmpty());
    }
  }

  @Test
  void idempotencyConflictThrowsWithTheBody() throws Exception {
    String body =
        "{\"status\":\"invalid\",\"issues\":[{\"code\":\"idempotency_conflict\",\"message\":\"another sale\"}],\"warnings\":[]}";
    try (FakeGateway gateway = new FakeGateway().reply(409, body)) {
      IdempotencyConflictException e =
          assertThrows(
              IdempotencyConflictException.class,
              () -> client(gateway).submitSale(sale(), new RequestOptions().idempotencyKey("R-1")));
      assertEquals(409, e.status());
      assertEquals("idempotency_conflict", e.code());
      assertEquals("invalid", e.result().status());
      assertTrue(e instanceof ConflictException);
    }
  }

  @Test
  void errorStatusesMapToTheirExceptions() throws Exception {
    String error = "{\"error\":{\"code\":\"unauthorized\",\"message\":\"bad key\"}}";
    try (FakeGateway gateway =
        new FakeGateway()
            .reply(401, error)
            .reply(404, "{\"error\":{\"code\":\"not_found\",\"message\":\"no sale\"}}")
            .reply(409, "{\"error\":{\"code\":\"not_retryable\",\"message\":\"final\"}}")
            .reply(500, "<html>boom</html>", "Content-Type", "text/html")
            .reply(429, "")) {
      EetGatewayClient client = client(gateway);
      AuthenticationException unauthorized = assertThrows(AuthenticationException.class, () -> client.getSale("a"));
      assertEquals("unauthorized", unauthorized.code());
      assertEquals("bad key", unauthorized.detail());
      assertTrue(unauthorized.getMessage().contains("HTTP 401"));
      assertThrows(NotFoundException.class, () -> client.getSale("b"));
      ConflictException conflict = assertThrows(ConflictException.class, () -> client.retrySale("c"));
      assertEquals("not_retryable", conflict.code());
      ServerException server = assertThrows(ServerException.class, () -> client.getSale("d"));
      assertEquals("<html>boom</html>", server.detail());
      ApiException other = assertThrows(ApiException.class, () -> client.getSale("e"));
      assertEquals(429, other.status());
      assertEquals("http_error", other.code());
    }
  }

  @Test
  void idempotencyKeyIsCheckedBeforeAnythingIsSent() throws Exception {
    try (FakeGateway gateway = new FakeGateway()) {
      EetGatewayClient client = client(gateway);
      assertThrows(IllegalArgumentException.class, () -> client.submitSale(sale(), new RequestOptions().idempotencyKey("")));
      assertThrows(IllegalArgumentException.class, () -> client.submitSale(sale(), new RequestOptions().idempotencyKey("a b")));
      assertThrows(IllegalArgumentException.class, () -> client.submitSale(sale(), new RequestOptions().idempotencyKey("x".repeat(256))));
      assertTrue(gateway.seen.isEmpty());
    }
  }

  @Test
  void waitForSalePollsUntilTheSaleIsDecided() throws Exception {
    try (FakeGateway gateway =
        new FakeGateway()
            .reply(202, FakeGateway.sale("s1", "queued"))
            .reply(200, FakeGateway.sale("s1", "uncertain"))
            .reply(200, FakeGateway.accepted("s1"))) {
      EetGatewayClient client = client(gateway);
      SaleResult queued = client.submitSale(sale());
      assertTrue(queued.isPending());
      SaleResult done = client.waitForSale(queued, Duration.ofSeconds(5), Duration.ofMillis(10));
      assertEquals("accepted", done.status());
      assertEquals(3, gateway.seen.size());
      assertEquals("/v1/sales/s1", gateway.last().path());
    }
  }

  @Test
  void waitForSaleGivesUpAndReturnsTheLastState() throws Exception {
    try (FakeGateway gateway = new FakeGateway()) {
      for (int i = 0; i < 50; i++) gateway.reply(200, FakeGateway.sale("s1", "queued"));
      SaleResult last = client(gateway).waitForSale("s1", Duration.ofMillis(100), Duration.ofMillis(20));
      assertTrue(last.isPending());
    }
  }

  @Test
  void listQueueEncodesTheFilter() throws Exception {
    try (FakeGateway gateway = new FakeGateway().reply(200, "{\"items\":[" + FakeGateway.sale("s1", "queued") + "],\"nextCursor\":null}")) {
      QueuePage page =
          client(gateway)
              .listQueue(
                  QueueFilter.all()
                      .status(SaleStatus.QUEUED, SaleStatus.UNCERTAIN)
                      .register("main")
                      .from("2027-01-05T12:00:00+01:00")
                      .overdue(true)
                      .limit(10));
      assertEquals(
          "status=queued%2Cuncertain&register=main&from=2027-01-05T12%3A00%3A00%2B01%3A00&overdue=true&limit=10",
          gateway.last().query());
      assertEquals(1, page.items().size());
      assertNull(page.nextCursor());
    }
  }

  @Test
  void iterateQueueFollowsTheCursor() throws Exception {
    try (FakeGateway gateway =
        new FakeGateway()
            .reply(200, "{\"items\":[" + FakeGateway.sale("a", "queued") + "," + FakeGateway.sale("b", "queued") + "],\"nextCursor\":\"c1\"}")
            .reply(200, "{\"items\":[" + FakeGateway.sale("c", "queued") + "],\"nextCursor\":null}")) {
      List<String> ids = new ArrayList<>();
      for (SaleResult sale : client(gateway).iterateQueue(QueueFilter.all().limit(2))) ids.add(sale.id());
      assertEquals(List.of("a", "b", "c"), ids);
      assertEquals("limit=2", gateway.seen.get(0).query());
      assertEquals("limit=2&cursor=c1", gateway.seen.get(1).query());
    }
  }

  @Test
  void healthIsPublicAndADegradedGatewayIsReturned() throws Exception {
    String body =
        "{\"status\":\"degraded\",\"version\":\"0.2.0\",\"database\":\"error\",\"eet\":[{\"endpoint\":\"e\",\"reachable\":false,\"durationMs\":12.5,\"checkedAt\":\"t\",\"error\":\"x\"}]}";
    try (FakeGateway gateway = new FakeGateway().reply(503, body)) {
      Health health = client(gateway).health(true);
      assertEquals("eet=true", gateway.last().query());
      assertFalse(gateway.last().headers().containsKey("authorization"));
      assertFalse(health.isOk());
      assertEquals("error", health.database());
      assertEquals(12.5, health.eet().get(0).durationMs());
    }
  }

  @Test
  void batchRegistersAttemptsAndValidationAreParsed() throws Exception {
    String attempt =
        "{\"n\":1,\"uuid_zpravy\":\"u\",\"dat_odesl\":\"d\",\"prvni_zaslani\":true,\"overeni\":false,\"environment\":\"playground\",\"endpoint\":\"e\",\"startedAt\":\"t\",\"outcome\":\"accepted\",\"durationMs\":42}";
    String cert =
        "{\"eic\":\"CZ1\",\"subject\":\"s\",\"issuer\":\"i\",\"serialNumber\":\"1\",\"fingerprintSha256\":\"f\",\"notBefore\":\"a\",\"notAfter\":\"b\",\"daysLeft\":30,\"active\":true,\"expiresSoon\":false,\"expired\":false}";
    String register =
        "{\"id\":\"main\",\"environment\":\"playground\",\"endpoint\":\"e\",\"timeZone\":\"Europe/Prague\",\"defaults\":{\"id_pokl\":\"P1\"},\"certificates\":[" + cert + "]}";
    try (FakeGateway gateway =
        new FakeGateway()
            .reply(200, "{\"rows\":[{\"row\":1,\"result\":" + FakeGateway.accepted("s1") + "}],\"warnings\":[]}")
            .reply(200, "{\"items\":[" + attempt + "]}")
            .reply(200, "{\"items\":[" + register + "]}")
            .reply(200, "{\"rows\":[{\"row\":1,\"result\":{\"valid\":true,\"warnings\":[],\"issues\":[],\"data\":" + FakeGateway.DATA + ",\"overeni\":false,\"prvni_zaslani\":true}}]}")
            .reply(422, "{\"rows\":[],\"issues\":[{\"code\":\"unreadable\",\"message\":\"bad csv\"}]}")) {
      EetGatewayClient client = client(gateway);

      BatchResult batch = client.submitBatch(List.of(sale()), new RequestOptions().idempotencyKey("B-1").mode("async"));
      assertEquals("/v1/sales/batch", gateway.last().path());
      assertEquals("[", gateway.last().body().substring(0, 1));
      assertEquals(1, batch.rows().get(0).row());
      assertEquals("POK-1", batch.rows().get(0).result().pok());

      Attempt a = client.getSaleAttempts("s1").get(0);
      assertEquals("/v1/sales/s1/attempts", gateway.last().path());
      assertTrue(a.prvniZaslani());
      assertEquals(42, a.durationMs());
      assertNull(a.finishedAt());

      Register r = client.listRegisters().get(0);
      assertEquals("Europe/Prague", r.timeZone());
      assertEquals("P1", r.defaults().get("id_pokl"));
      assertEquals(30, r.certificates().get(0).daysLeft());

      ValidationBatch valid = client.validateSales(List.of(sale()), new RequestOptions().verify(true));
      assertEquals("verify=true", gateway.last().query());
      assertTrue(valid.isValid());
      assertEquals(Boolean.TRUE, valid.rows().get(0).result().prvniZaslani());

      ValidationBatch unreadable = client.validateSalesRaw("a,b", "text/csv", null);
      assertEquals("text/csv", gateway.last().headers().get("content-type"));
      assertFalse(unreadable.isValid());
      assertEquals("unreadable", unreadable.issues().get(0).code());
    }
  }

  @Test
  void aSlowGatewayIsATimeout() throws Exception {
    try (FakeGateway gateway = new FakeGateway().reply(1500, 200, FakeGateway.sale("s1", "queued"))) {
      EetGatewayClient client = EetGatewayClient.builder(gateway.url()).timeout(Duration.ofMillis(150)).build();
      assertThrows(RequestTimeoutException.class, () -> client.getSale("s1"));
    }
  }

  @Test
  void noAnswerIsATransportError() throws Exception {
    String url;
    try (FakeGateway gateway = new FakeGateway()) {
      url = gateway.url();
    }
    EetGatewayClient client = EetGatewayClient.builder(url).timeout(Duration.ofSeconds(2)).build();
    TransportException e = assertThrows(TransportException.class, () -> client.getSale("s1"));
    assertFalse(e instanceof RequestTimeoutException);
  }

  @Test
  void anAnswerThatIsNotTheDocumentedJsonIsInvalid() throws Exception {
    try (FakeGateway gateway =
        new FakeGateway().reply(200, "not json").reply(200, "{\"status\":\"accepted\",\"data\":{\"eic_popl\":\"x\"}}")) {
      EetGatewayClient client = client(gateway);
      InvalidResponseException notJson = assertThrows(InvalidResponseException.class, () -> client.getSale("s1"));
      assertEquals(200, notJson.status());
      assertThrows(InvalidResponseException.class, () -> client.getSale("s1"));
    }
  }

  @Test
  void redirectsAreNotFollowed() throws Exception {
    try (FakeGateway gateway = new FakeGateway().reply(302, "", "Location", "http://elsewhere.invalid/")) {
      ApiException e = assertThrows(ApiException.class, () -> client(gateway).submitSale(sale()));
      assertEquals(302, e.status());
      assertEquals(1, gateway.seen.size());
    }
  }

  @Test
  void pathParametersAreEncodedAndRawBodiesAreSentAsGiven() throws Exception {
    try (FakeGateway gateway = new FakeGateway().reply(404, "{\"error\":{\"code\":\"not_found\",\"message\":\"x\"}}").reply(200, FakeGateway.accepted("s1"))) {
      EetGatewayClient client = client(gateway);
      assertThrows(NotFoundException.class, () -> client.getSale("a/b c"));
      assertEquals("/v1/sales/a%2Fb%20c", gateway.last().path());

      client.submitSaleRaw("<Trzba/>", "application/xml", null);
      assertEquals("<Trzba/>", gateway.last().body());
      assertEquals("application/xml", gateway.last().headers().get("content-type"));
    }
  }

  @Test
  void aBaseUrlWithoutSchemeIsRejected() {
    assertThrows(IllegalArgumentException.class, () -> EetGatewayClient.builder("localhost:8080"));
  }
}
