import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXIT,
  exitCodeFor,
  RevolutError,
  reportError,
  reportNdjson,
  reportSuccess,
  stringify,
} from "./errors.ts";

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

  it("surfaces revolut_error_code when present", () => {
    expect(() =>
      reportError(
        new RevolutError("blocked", {
          code: "IP_NOT_WHITELISTED",
          status: 403,
          revolut_error_code: 9002,
        }),
        "balance",
      ),
    ).toThrow("__exit__");
    const json = JSON.parse(written);
    expect(json.revolut_error_code).toBe(9002);
    expect(json.code).toBe("IP_NOT_WHITELISTED");
    expect(exitCode).toBe(EXIT.NOPERM);
  });
});

describe("reportSuccess", () => {
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

  it("emits an {ok:true, data, command} envelope", () => {
    expect(() => reportSuccess({ slug: "x" }, "accounts")).toThrow("__exit__");
    const json = JSON.parse(written);
    expect(json).toEqual({
      ok: true,
      data: { slug: "x" },
      command: "accounts",
    });
    expect(exitCode).toBe(0);
  });

  it("merges extras into the envelope", () => {
    expect(() => reportSuccess([], "balance", { account: "all" })).toThrow(
      "__exit__",
    );
    const json = JSON.parse(written);
    expect(json.account).toBe("all");
  });
});

describe("reportNdjson", () => {
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

  it("emits one line per item plus a trailing meta line", () => {
    expect(() =>
      reportNdjson([{ id: "a" }, { id: "b" }], {
        has_more: false,
        returned: 2,
        limit: 100,
      }),
    ).toThrow("__exit__");

    const lines = written.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] as string)).toEqual({ id: "a" });
    expect(JSON.parse(lines[1] as string)).toEqual({ id: "b" });
    expect(JSON.parse(lines[2] as string)).toEqual({
      ok: true,
      meta: { has_more: false, returned: 2, limit: 100 },
    });
    expect(exitCode).toBe(0);
  });

  it("each item is on its own compact single line", () => {
    expect(() => reportNdjson([{ a: 1, b: 2 }])).toThrow("__exit__");
    // Compact => no internal newlines in each line.
    const firstLine = written.trim().split("\n")[0] ?? "";
    expect(firstLine).not.toMatch(/\n/);
    expect(firstLine).toBe('{"a":1,"b":2}');
  });
});

describe("stringify", () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it("returns 2-space indented JSON when stdout is a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    expect(stringify({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("returns compact JSON when stdout is piped", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });
    expect(stringify({ a: 1 })).toBe('{"a":1}');
  });
});
