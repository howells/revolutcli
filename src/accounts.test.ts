import { describe, expect, it } from "vitest";
import { findAccount, type ResolvedAccount, slugify } from "./accounts.ts";

const fakeAccount = (
  name: string,
  overrides: Partial<ResolvedAccount> = {},
): ResolvedAccount => ({
  id: "00000000-0000-0000-0000-000000000000",
  name,
  slug: slugify(name),
  balance: 0,
  currency: "GBP",
  state: "active",
  public: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("slugify", () => {
  it("lowercases and dashes spaces", () => {
    expect(slugify("Anvil Cottage")).toBe("anvil-cottage");
  });

  it("collapses non-alphanumerics and trims edges", () => {
    expect(slugify("Cathcart   Phase 1!")).toBe("cathcart-phase-1");
    expect(slugify("--Edges--")).toBe("edges");
  });

  it("handles bracketed Revolut naming convention", () => {
    expect(slugify("Revolut [GBP] [Thanet]")).toBe("revolut-gbp-thanet");
  });
});

describe("findAccount", () => {
  const accounts = [
    fakeAccount("Anvil Cottage"),
    fakeAccount("Cathcart Phase 1"),
    fakeAccount("Thanet"),
  ];

  it("returns null when name is undefined", () => {
    expect(findAccount(accounts, undefined)).toBeNull();
  });

  it("matches exact slug", () => {
    expect(findAccount(accounts, "thanet")?.name).toBe("Thanet");
  });

  it("matches case-insensitively via slugify", () => {
    expect(findAccount(accounts, "ANVIL COTTAGE")?.name).toBe("Anvil Cottage");
  });

  it("matches by prefix when no exact match", () => {
    expect(findAccount(accounts, "cathcart")?.name).toBe("Cathcart Phase 1");
  });

  it("returns null for unknown account", () => {
    expect(findAccount(accounts, "nope")).toBeNull();
  });
});
