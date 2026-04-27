import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allBalances, balance, transactions } from "./commands.ts";

const fakeAccountResponse = [
  {
    id: "acc-1",
    name: "Anvil Cottage",
    balance: 1000.5,
    currency: "GBP",
    state: "active",
    public: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "acc-2",
    name: "Thanet",
    balance: 250,
    currency: "GBP",
    state: "active",
    public: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  },
];

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = (async (url: string) =>
    new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("allBalances", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("maps every Revolut account into a BalanceRow", async () => {
    mockFetch(() => fakeAccountResponse);
    const rows = await allBalances("token");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "acc-1",
      account: "Anvil Cottage",
      slug: "anvil-cottage",
      balance: 1000.5,
      formatted: "£1000.50",
      currency: "GBP",
      state: "active",
    });
  });
});

describe("balance", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the matching sub-account", async () => {
    mockFetch(() => fakeAccountResponse);
    const row = await balance("token", "thanet");
    expect(row.account).toBe("Thanet");
    expect(row.formatted).toBe("£250.00");
  });

  it("throws with a useful list when the slug is unknown", async () => {
    mockFetch(() => fakeAccountResponse);
    await expect(balance("token", "missing")).rejects.toThrow(
      /anvil-cottage, thanet/,
    );
  });

  it("throws RevolutError with ACCOUNT_NOT_FOUND code", async () => {
    mockFetch(() => fakeAccountResponse);
    await expect(balance("token", "missing")).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      is_retriable: false,
      suggestions: ["anvil-cottage", "thanet"],
      recovery_hint: "Run: revolutcli accounts",
    });
  });
});

describe("transactions", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("filters legs to the matched account_id and resolves merchant counterparty", async () => {
    let lastUrl = "";
    globalThis.fetch = (async (url: string) => {
      lastUrl = url;
      if (url.includes("/accounts")) {
        return new Response(JSON.stringify(fakeAccountResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify([
          {
            id: "tx-1",
            type: "card_payment",
            state: "completed",
            created_at: "2026-04-10T08:00:00Z",
            completed_at: "2026-04-10T08:01:00Z",
            reference: "Coffee",
            legs: [
              {
                leg_id: "leg-1",
                account_id: "acc-1",
                amount: -3.5,
                currency: "GBP",
                description: "Caffe Nero",
              },
            ],
            merchant: { name: "Caffe Nero", category_code: "5814" },
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const page = await transactions("token", "anvil-cottage", {
      from: "2026-04-01",
      limit: 5,
    });

    expect(lastUrl).toContain("account=acc-1");
    expect(lastUrl).toContain("from=2026-04-01");
    expect(lastUrl).toContain("count=5");
    expect(page.data[0]).toMatchObject({
      id: "tx-1",
      counterParty: "Caffe Nero",
      amount: -3.5,
      formatted: "£-3.50",
      category: "5814",
    });
    expect(page.meta).toEqual({
      returned: 1,
      limit: 5,
      has_more: false,
    });
  });

  it("flags has_more when returned matches the requested limit", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/accounts")) {
        return new Response(JSON.stringify(fakeAccountResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Return exactly 2 rows for limit=2 — pagination heuristic
      return new Response(
        JSON.stringify([
          {
            id: "tx-1",
            type: "card_payment",
            state: "completed",
            created_at: "2026-04-10T08:00:00Z",
            legs: [
              {
                leg_id: "leg-1",
                account_id: "acc-1",
                amount: -1,
                currency: "GBP",
              },
            ],
          },
          {
            id: "tx-2",
            type: "card_payment",
            state: "completed",
            created_at: "2026-04-11T08:00:00Z",
            legs: [
              {
                leg_id: "leg-2",
                account_id: "acc-1",
                amount: -2,
                currency: "GBP",
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const page = await transactions("token", "anvil-cottage", { limit: 2 });
    expect(page.meta.has_more).toBe(true);
    expect(page.meta.returned).toBe(2);
    expect(page.meta.limit).toBe(2);
  });

  it("throws ACCOUNT_NOT_FOUND with structured suggestions", async () => {
    mockFetch(() => fakeAccountResponse);
    await expect(
      transactions("token", "missing-account"),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
      is_retriable: false,
      suggestions: ["anvil-cottage", "thanet"],
    });
  });
});
