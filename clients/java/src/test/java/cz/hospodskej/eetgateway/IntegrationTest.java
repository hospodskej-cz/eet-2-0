package cz.hospodskej.eetgateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Against the real gateway over a fake EET (no network, no certificates):
 *
 * <pre>
 * bun scripts/examples-server.ts 8080 &amp;
 * EET_URL=http://localhost:8080 EET_API_KEY=examples-key-0123456789 mvn test -Dtest=IntegrationTest
 * </pre>
 *
 * Skipped without EET_URL. The first attempt of every sale "times out", the resend half a second
 * later is accepted (scripts/examples-server.ts), so this also walks the 202 to polling path.
 */
class IntegrationTest {
  private static final String URL = System.getenv("EET_URL");
  private static final String KEY =
      System.getenv("EET_API_KEY") != null ? System.getenv("EET_API_KEY") : "examples-key-0123456789";

  private EetGatewayClient client;

  @BeforeEach
  void connect() {
    assumeTrue(URL != null && !URL.isEmpty(), "set EET_URL to run against a gateway");
    client = EetGatewayClient.builder(URL).apiKey(KEY).timeout(Duration.ofSeconds(15)).build();
  }

  private static Map<String, Object> sale(String receipt) {
    return SaleInput.of(OffsetDateTime.now().truncatedTo(ChronoUnit.SECONDS), "123.50")
        .poradCis(receipt)
        .toMap();
  }

  @Test
  void submitWaitAndIdempotentReplay() {
    String receipt = "JT-" + System.nanoTime();
    Map<String, Object> body = sale(receipt); // the same sale again, or the key counts as reused
    RequestOptions options = new RequestOptions().idempotencyKey(receipt);

    SaleResult first = client.submitSale(body, options);
    assertNotNull(first.id());
    assertEquals("/v1/sales/" + first.id(), first.location());
    assertTrue(first.isPending()); // fake EET: the first attempt times out
    SaleResult done = client.waitForSale(first, Duration.ofSeconds(15), Duration.ofMillis(200));
    assertEquals("accepted", done.status());
    assertNotNull(done.pok());

    SaleResult again = client.submitSale(body, options);
    assertEquals(first.id(), again.id());
    assertTrue(again.replayed());

    List<Attempt> attempts = client.getSaleAttempts(first.id());
    assertEquals(List.of(true, false), attempts.stream().map(Attempt::prvniZaslani).toList());
    assertEquals("accepted", attempts.get(attempts.size() - 1).outcome());
    boolean listed = false;
    for (SaleResult s : client.iterateQueue(QueueFilter.all().limit(5))) {
      if (first.id().equals(s.id())) listed = true;
    }
    assertTrue(listed);
  }

  @Test
  void verificationModeAndInvalidSale() {
    SaleResult checked =
        client.submitSale(sale("JV-" + System.nanoTime()), new RequestOptions().verify(true));
    checked = client.waitForSale(checked, Duration.ofSeconds(15), Duration.ofMillis(200));
    assertEquals("verification_ok", checked.status());
    assertTrue(checked.isSuccess());

    SaleResult invalid = client.submitSale(Map.of("porad_cis", "X"));
    assertEquals("invalid", invalid.status());
    assertFalse(invalid.issues().isEmpty());
    assertNull(invalid.id());
  }

  @Test
  void batchValidateAndSystemEndpoints() {
    long now = System.nanoTime();
    List<Map<String, Object>> rows = List.of(sale("JB-" + now + "-0"), sale("JB-" + now + "-1"));
    ValidationBatch verdict = client.validateSales(rows, null);
    assertTrue(verdict.isValid());
    assertEquals(2, verdict.rows().size());
    BatchResult batch = client.submitBatch(rows, new RequestOptions().idempotencyKey("batch-" + now));
    assertEquals(List.of(1, 2), batch.rows().stream().map(BatchRow::row).toList());

    assertTrue(client.health().isOk());
    assertTrue(String.valueOf(client.getOpenApi().get("openapi")).startsWith("3.1"));
    assertTrue(client.getDocs().contains("<"));
    assertNotNull(client.listRegisters());
  }

  @Test
  void errors() {
    assertThrows(NotFoundException.class, () -> client.getSale("does-not-exist"));
    EetGatewayClient wrong =
        EetGatewayClient.builder(URL).apiKey("wrong-key-0123456789").timeout(Duration.ofSeconds(15)).build();
    assertThrows(AuthenticationException.class, () -> wrong.listQueue(null));
  }
}
