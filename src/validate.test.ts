import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAccountName, validateDate } from "./validate.ts";

function expectExits(fn: () => void, pattern?: RegExp) {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
    _code?: number,
  ) => {
    throw new Error("__exit__");
  }) as unknown as never);
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  try {
    expect(fn).toThrow("__exit__");
    if (pattern) {
      const written = writeSpy.mock.calls.map((c) => c[0]).join("");
      expect(written).toMatch(pattern);
    }
  } finally {
    exitSpy.mockRestore();
    writeSpy.mockRestore();
  }
}

describe("validateDate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts ISO date", () => {
    expect(() =>
      validateDate("2026-04-01", "from", "transactions"),
    ).not.toThrow();
  });

  it("accepts ISO datetime", () => {
    expect(() =>
      validateDate("2026-04-01T12:00:00Z", "from", "transactions"),
    ).not.toThrow();
  });

  it("rejects natural-language date", () => {
    expectExits(
      () => validateDate("yesterday", "from", "transactions"),
      /ISO 8601/,
    );
  });

  it("rejects path traversal", () => {
    expectExits(
      () => validateDate("2026-../etc", "from", "transactions"),
      /path traversal/,
    );
  });

  it("rejects control characters", () => {
    expectExits(
      () => validateDate("2026-04-01", "from", "transactions"),
      /control characters/,
    );
  });
});

describe("validateAccountName", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a normal slug", () => {
    expect(() => validateAccountName("anvil-cottage", "balance")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expectExits(() => validateAccountName("../etc", "balance"));
  });
});
