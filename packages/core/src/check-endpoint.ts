/**
 * Network reachability of an EET endpoint from wherever the integrator runs the library. Sends
 * only the CORS preflight the service documents (rozhraní §2.3.3: `OPTIONS` → 204) — no data
 * message, nothing is registered. The EET playground, for example, does not accept connections
 * from GitHub-hosted runners (SPEC_NOTES §15); production may filter source addresses too.
 */

export interface EndpointCheck {
  /** An HTTP answer came back (any status). */
  readonly reachable: boolean;
  /** 204 is what the service documents for a valid preflight. */
  readonly httpStatus?: number | undefined;
  readonly durationMs: number;
  /** Why the endpoint could not be reached (DNS, connect timeout, TLS, …). */
  readonly error?: string | undefined;
}

export interface CheckEndpointOptions {
  readonly timeoutMs?: number | undefined;
  readonly fetch?: ((input: string, init?: RequestInit) => Promise<Response>) | undefined;
}

export async function checkEndpoint(
  endpoint: string,
  options: CheckEndpointOptions = {},
): Promise<EndpointCheck> {
  const started = performance.now();
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    const response = await doFetch(endpoint, {
      method: "OPTIONS",
      headers: {
        Origin: "https://localhost",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, SOAPAction",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    await response.body?.cancel();
    return {
      reachable: true,
      httpStatus: response.status,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const cause = (error as { cause?: { message?: unknown } }).cause?.message;
    return {
      reachable: false,
      durationMs: Math.round(performance.now() - started),
      error: [
        String((error as Error).message ?? error),
        typeof cause === "string" ? cause : undefined,
      ]
        .filter(Boolean)
        .join(": "),
    };
  }
}
