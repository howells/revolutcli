import { describe, expect, it } from "vitest";
import {
  findAccount,
  type ResolvedAccount,
  type RevolutAccount,
  resolveSlugs,
  slugify,
} from "./accounts.ts";

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

describe("resolveSlugs", () => {
  /** Bare-bones factory for RevolutAccount fixtures. */
  const acct = (
    id: string,
    overrides: Partial<RevolutAccount> = {},
  ): RevolutAccount => ({
    id,
    name: "X",
    balance: 0,
    currency: "GBP",
    state: "active",
    public: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("falls back to unnamed-<currency> when name is missing", () => {
    // Real bug: live Revolut returned an account with no `name` field;
    // slugify() crashed on undefined.toLowerCase().
    const out = resolveSlugs([
      acct("aaaa", { name: undefined, currency: "GBP" }),
    ]);
    expect(out[0]?.slug).toBe("unnamed-gbp");
    expect(out[0]?.name).toBe("unnamed-GBP");
  });

  it("treats empty-string name as missing", () => {
    const out = resolveSlugs([acct("aaaa", { name: "   ", currency: "USD" })]);
    expect(out[0]?.slug).toBe("unnamed-usd");
  });

  it("disambiguates duplicate names by currency", () => {
    // Real bug: live Revolut had two accounts both named "Main" — one EUR,
    // one USD — which collapsed to a single "main" slug under findAccount.
    const out = resolveSlugs([
      acct("aaaa", { name: "Main", currency: "EUR" }),
      acct("bbbb", { name: "Main", currency: "USD" }),
    ]);
    expect(out.map((a) => a.slug).sort()).toEqual(["main-eur", "main-usd"]);
  });

  it("leaves unique names alone", () => {
    const out = resolveSlugs([
      acct("aaaa", { name: "Phaia" }),
      acct("bbbb", { name: "Anvil Cottage" }),
    ]);
    expect(out.map((a) => a.slug)).toEqual(["phaia", "anvil-cottage"]);
  });

  it("appends id suffix when currency disambiguation also collides", () => {
    const out = resolveSlugs([
      acct("11111111-1111-1111-1111-aaaaaaaaaaaa", {
        name: "Main",
        currency: "GBP",
      }),
      acct("22222222-2222-2222-2222-bbbbbbbbbbbb", {
        name: "Main",
        currency: "GBP",
      }),
    ]);
    expect(out[0]?.slug).toBe("main-gbp");
    expect(out[1]?.slug).toBe("main-gbp-bbbbbb");
  });

  it("guarantees unique slugs across the result set", () => {
    const out = resolveSlugs([
      acct("aaaa", { name: undefined, currency: "GBP" }),
      acct("bbbb", { name: "Main", currency: "EUR" }),
      acct("cccc", { name: "Main", currency: "USD" }),
      acct("dddd", { name: "Phaia" }),
    ]);
    const slugs = out.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
