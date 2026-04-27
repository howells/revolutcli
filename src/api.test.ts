import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, BASE_URL, formatAmount } from "./api.ts";

describe("formatAmount", () => {
  it("uses £ for GBP", () => {
    expect(formatAmount(12.5, "GBP")).toBe("£12.50");
  });

  it("uses $ for USD", () => {
    expect(formatAmount(7, "USD")).toBe("$7.00");
  });

  it("falls back to the currency code for unknown codes", () => {
    expect(formatAmount(3.1, "EUR")).toBe("EUR3.10");
  });
});

describe("api()", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("attaches the bearer token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api({ token: "tok-1", path: "/api/1.0/accounts" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer tok-1");
  });

  it("appends defined query params and skips empty ones", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api({
      token: "t",
      path: "/api/1.0/transactions",
      query: {
        account: "acc-id",
        from: "2026-01-01",
        to: undefined,
        count: 10,
      },
    });

    expect(calledUrl).toBe(
      `${BASE_URL}/api/1.0/transactions?account=acc-id&from=2026-01-01&count=10`,
    );
  });

  it("throws with the response status when not OK", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toThrow(
      /Revolut API 401/,
    );
  });

  it("classifies 401 as AUTH_REFUSED, not retriable", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "AUTH_REFUSED",
      status: 401,
      is_retriable: false,
    });
  });

  it("classifies 429 as RATE_LIMITED, retriable, with retry_after_seconds", async () => {
    globalThis.fetch = (async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "30" },
      })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      is_retriable: true,
      retry_after_seconds: 30,
    });
  });

  it("classifies 503 as API_ERROR, retriable", async () => {
    globalThis.fetch = (async () =>
      new Response("upstream down", {
        status: 503,
      })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "API_ERROR",
      status: 503,
      is_retriable: true,
    });
  });

  it("classifies network failures as NETWORK_ERROR, retriable", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      is_retriable: true,
    });
  });

  it("classifies 403 with code 9002 as IP_NOT_WHITELISTED", async () => {
    // Live shape we observed from Revolut.
    const body = JSON.stringify({
      message: "IP address not whitelisted. Verify IP whitelist configuration.",
      code: 9002,
    });
    globalThis.fetch = (async () =>
      new Response(body, { status: 403 })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "IP_NOT_WHITELISTED",
      status: 403,
      revolut_error_code: 9002,
      is_retriable: false,
    });
  });

  it("403 without a known vendor code falls through to INSUFFICIENT_SCOPE", async () => {
    const body = JSON.stringify({ message: "Forbidden", code: 1234 });
    globalThis.fetch = (async () =>
      new Response(body, { status: 403 })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      status: 403,
      revolut_error_code: 1234,
      is_retriable: false,
    });
  });

  it("surfaces revolut_error_code on 401 too", async () => {
    const body = JSON.stringify({ message: "Token expired", code: 1041 });
    globalThis.fetch = (async () =>
      new Response(body, { status: 401 })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "AUTH_REFUSED",
      status: 401,
      revolut_error_code: 1041,
    });
  });

  it("falls back gracefully when error body is not JSON", async () => {
    globalThis.fetch = (async () =>
      new Response("upstream-html-page", {
        status: 502,
      })) as unknown as typeof fetch;
    await expect(api({ token: "t", path: "/x" })).rejects.toMatchObject({
      code: "API_ERROR",
      status: 502,
      is_retriable: true,
    });
  });
});

describe("parseRevolutErrorBody", () => {
  it("extracts message and numeric code from JSON body", async () => {
    const { parseRevolutErrorBody } = await import("./api.ts");
    expect(
      parseRevolutErrorBody(JSON.stringify({ message: "nope", code: 9002 })),
    ).toEqual({ detail: "nope", revolut_error_code: 9002 });
  });

  it("returns raw body as detail when not JSON", async () => {
    const { parseRevolutErrorBody } = await import("./api.ts");
    expect(parseRevolutErrorBody("<html>oops</html>")).toEqual({
      detail: "<html>oops</html>",
    });
  });

  it("ignores non-numeric code field", async () => {
    const { parseRevolutErrorBody } = await import("./api.ts");
    expect(
      parseRevolutErrorBody(JSON.stringify({ message: "x", code: "9002" })),
    ).toEqual({ detail: "x" });
  });

  it("handles empty body", async () => {
    const { parseRevolutErrorBody } = await import("./api.ts");
    expect(parseRevolutErrorBody("")).toEqual({ detail: "" });
  });
});
