import { expect, test } from "bun:test";
import { checkEndpoint } from "../src/index.ts";

test("a preflight answer means reachable, and only OPTIONS is sent", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const result = await checkEndpoint("https://pg.example/eet", {
    fetch: async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(null, { status: 204 });
    },
  });
  expect(result).toMatchObject({ reachable: true, httpStatus: 204 });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.init?.method).toBe("OPTIONS");
  expect(calls[0]?.init?.body).toBeUndefined();
});

test("network failures are reported, not thrown", async () => {
  const result = await checkEndpoint("https://pg.example/eet", {
    fetch: async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("connect ETIMEDOUT 5.145.110.163:443"),
      });
    },
  });
  expect(result).toMatchObject({ reachable: false });
  expect(result.error).toContain("ETIMEDOUT");
});
