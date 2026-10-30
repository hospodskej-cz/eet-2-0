package cz.hospodskej.eetgateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The operation table of the client equals docs/openapi.json. (scripts/gen-clients.ts checks the
 * same, plus parameters and properties, in the repository's own CI.)
 */
class OpenApiCoverageTest {
  @Test
  void everyOperationOfTheSpecIsInTheClientAndNothingElse() throws IOException {
    Path spec = Path.of("..", "..", "docs", "openapi.json");
    assumeTrue(Files.exists(spec), "not inside the repository checkout");
    Map<String, Object> doc = Json.object(Json.parse(Files.readString(spec, StandardCharsets.UTF_8)));
    Map<String, String> expected = new LinkedHashMap<>();
    for (Map.Entry<String, Object> path : Json.obj(doc, "paths").entrySet()) {
      for (Map.Entry<String, Object> method : Json.object(path.getValue()).entrySet()) {
        Map<String, Object> operation = Json.object(method.getValue());
        if (operation == null || operation.get("operationId") == null) continue;
        expected.put(
            operation.get("operationId").toString(),
            method.getKey().toUpperCase(Locale.ROOT) + " " + path.getKey());
      }
    }
    assertEquals(expected, EetGatewayClient.operations());
  }
}
