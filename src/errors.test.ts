import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT, exitCodeFor, RevolutError, reportError } from "./errors.ts";

describe("RevolutError", () => {
  it("defaults is_retriable to false", () => {
    const e = new RevolutError("oops", { code: "INTERNAL" });
    expect(e.is_retriable).toBe(false);
  });

  it("preserves code, status, and recovery_hint", () => {
    const e = new RevolutError("rate limited", {
      code: "RATE_LIMITED",
      status: 429,
      is_retriable: true,
      retry_after_seconds: 10,
      recovery_hint: "Wait 10s and retry.",
    });
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.status).toBe(429);
    expect(e.retry_after_seconds).toBe(10);
    expect(e.recovery_hint).toBe("Wait 10s and retry.");
  });

  it("preserves suggestions array", () => {
    const e = new RevolutError("not found", {
      code: "ACCOUNT_NOT_FOUND",
      suggestions: ["a", "b"],
    });
    expect(e.suggestions).toEqual(["a", "b"]);
  });
});

describe("exitCodeFor", () => {
  it("maps usage to 64", () => {
    expect(exitCodeFor("USAGE")).toBe(EXIT.USAGE);
  });
  it("maps validation to 65", () => {
    expect(exitCodeFor("VALIDATION")).toBe(EXIT.DATAERR);
  });
  it("maps auth codes to 77", () => {
    expect(exitCodeFor("AUTH_MISSING")).toBe(EXIT.NOPERM);
    expect(exitCodeFor("AUTH_EXPIRED")).toBe(EXIT.NOPERM);
    expect(exitCodeFor("AUTH_REFUSED")).toBe(EXIT.NOPERM);
  });
  it("maps account-not-found to 78", () => {
    expect(exitCodeFor("ACCOUNT_NOT_FOUND")).toBe(EXIT.NOTFOUND);
  });
  it("maps service-class errors to 69", () => {
    expect(exitCodeFor("RATE_LIMITED")).toBe(EXIT.UNAVAILABLE);
    expect(exitCodeFor("API_ERROR")).toBe(EXIT.UNAVAILABLE);
    expect(exitCodeFor("NETWORK_ERROR")).toBe(EXIT.UNAVAILABLE);
  });
  it("maps internal to 1", () => {
    expect(exitCodeFor("INTERNAL")).toBe(EXIT.GENERIC);
  });
});

describe("reportError", () => {
  let exitCode: number | undefined;
  let written: string;

  beforeEach(() => {
    exitCode = undefined;
    written = "";
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error("__exit__");
    }) as unknown as never);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      written += String(chunk);
      return true;
    }) as unknown as typeof process.stdout.write);
  });

  afterEach(() => vi.restoreAllMocks());

  it("serializes a RevolutError into the structured envelope", () => {
    expect(() =>
      reportError(
        new RevolutError("Refresh token expired", {
          code: "AUTH_EXPIRED",
          status: 401,
          is_retriable: false,
          recovery_hint: "Re-run: revolutcli auth",
        }),
        "balance",
      ),
    ).toThrow("__exit__");
    const json = JSON.parse(written);
    expect(json).toMatchObject({
      ok: false,
      error: "Refresh token expired",
      code: "AUTH_EXPIRED",
      is_retriable: false,
      command: "balance",
      status: 401,
      recovery_hint: "Re-run: revolutcli auth",
    });
    expect(exitCode).toBe(EXIT.NOPERM);
  });

  it("wraps plain Error as INTERNAL with exit 1", () => {
    expect(() => reportError(new Error("kaboom"), "accounts")).toThrow(
      "__exit__",
    );
    const json = JSON.parse(written);
    expect(json).toMatchObject({
      ok: false,
      error: "kaboom",
      code: "INTERNAL",
      is_retriable: false,
      command: "accounts",
    });
    expect(exitCode).toBe(EXIT.GENERIC);
  });

  it("omits absent optional fields", () => {
    expect(() =>
      reportError(
        new RevolutError("simple", { code: "USAGE", is_retriable: false }),
      ),
    ).toThrow("__exit__");
    const json = JSON.parse(written);
    expect(json.status).toBeUndefined();
    expect(json.suggestions).toBeUndefined();
    expect(json.retry_after_seconds).toBeUndefined();
  });

  it("includes suggestions array when present and non-empty", () => {
    expect(() =>
      reportError(
        new RevolutError("not found", {
          code: "ACCOUNT_NOT_FOUND",
          suggestions: ["a", "b", "c"],
        }),
      ),
    ).toThrow("__exit__");
    const json = JSON.parse(written);
    expect(json.suggestions).toEqual(["a", "b", "c"]);
  });
});
