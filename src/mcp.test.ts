/**
 * MCP server integration tests using InMemoryTransport.
 *
 * The transport pair lets us drive the server like a real MCP client without
 * spinning up a child process. Each test sets up `globalThis.fetch` to mock
 * Revolut's HTTP API and a token cache via tmp-dir env vars (handled by a
 * pre-set HOME in the test, not done here — instead we mock loadCachedTokens
 * indirectly by writing a file before the test).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./mcp.ts";

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
];

/** Stage a token cache so getAccessToken() short-circuits to it. */
function stageTokenCache() {
  const dir = mkdtempSync(join(tmpdir(), "revolutcli-mcp-test-"));
  process.env.HOME = dir;
  const tokenDir = join(dir, ".revolutcli");
  // mkdir is async in real auth.ts, but we don't need it here — saveTokens
  // does the mkdir. We're staging a pre-existing token by writing directly.
  // Use sync mkdir.
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(
    join(tokenDir, "tokens.json"),
    JSON.stringify({
      access_token: "tok-abc",
      refresh_token: "rt-abc",
      // Far future so refresh isn't triggered.
      expires_at: Date.now() + 3_600_000,
    }),
  );
  return dir;
}

async function makeClient() {
  const server = buildServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server", () => {
  let originalFetch: typeof fetch;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHome) process.env.HOME = originalHome;
    vi.restoreAllMocks();
  });

  it("lists the four expected tools with verb_noun naming", async () => {
    stageTokenCache();
    const { client } = await makeClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_balance",
      "get_schema",
      "list_accounts",
      "list_transactions",
    ]);
  });

  it("annotates every tool as readOnlyHint=true", async () => {
    stageTokenCache();
    const { client } = await makeClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("list_accounts returns the {ok, data} envelope on success", async () => {
    stageTokenCache();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(fakeAccountResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const { client } = await makeClient();
    const result = (await client.callTool({
      name: "list_accounts",
      arguments: {},
    })) as { structuredContent: { ok: boolean; data: unknown[] } };

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.data).toHaveLength(1);
    expect(
      (result.structuredContent.data as Array<{ slug: string }>)[0]?.slug,
    ).toBe("anvil-cottage");
  });

  it("get_balance with account=all returns every sub-account", async () => {
    stageTokenCache();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(fakeAccountResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const { client } = await makeClient();
    const result = (await client.callTool({
      name: "get_balance",
      arguments: { account: "all" },
    })) as {
      structuredContent: { ok: boolean; data: unknown[]; account: string };
    };

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.account).toBe("all");
    expect(Array.isArray(result.structuredContent.data)).toBe(true);
  });

  it("list_transactions surfaces meta.has_more in the envelope", async () => {
    stageTokenCache();
    globalThis.fetch = (async (url: string) => {
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
            legs: [
              {
                leg_id: "leg-1",
                account_id: "acc-1",
                amount: -1,
                currency: "GBP",
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const { client } = await makeClient();
    const result = (await client.callTool({
      name: "list_transactions",
      arguments: { account: "anvil-cottage", limit: 1 },
    })) as {
      structuredContent: {
        ok: boolean;
        data: unknown[];
        meta: { has_more: boolean; returned: number };
      };
    };

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.meta.has_more).toBe(true);
    expect(result.structuredContent.meta.returned).toBe(1);
  });

  it("returns structured error envelope when API rejects with 401", async () => {
    stageTokenCache();
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;

    const { client } = await makeClient();
    const result = (await client.callTool({
      name: "list_accounts",
      arguments: {},
    })) as {
      isError: boolean;
      structuredContent: {
        ok: boolean;
        code: string;
        is_retriable: boolean;
        status: number;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.code).toBe("AUTH_REFUSED");
    expect(result.structuredContent.status).toBe(401);
    expect(result.structuredContent.is_retriable).toBe(false);
  });

  it("returns AUTH_MISSING when no token cache is staged", async () => {
    // Point HOME at a fresh dir with no token cache.
    const dir = mkdtempSync(join(tmpdir(), "revolutcli-mcp-noauth-"));
    process.env.HOME = dir;

    const { client } = await makeClient();
    const result = (await client.callTool({
      name: "list_accounts",
      arguments: {},
    })) as {
      isError: boolean;
      structuredContent: { code: string; recovery_hint: string };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("AUTH_MISSING");
    expect(result.structuredContent.recovery_hint).toContain("revolutcli auth");
  });

  it("get_schema returns the same schema as the CLI", async () => {
    stageTokenCache();
    const { client } = await makeClient();
    const result = (await client.callTool({
      name: "get_schema",
      arguments: {},
    })) as {
      structuredContent: {
        ok: boolean;
        data: { cli: string; readOnly: boolean };
      };
    };

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.data.cli).toBe("revolutcli");
    expect(result.structuredContent.data.readOnly).toBe(true);
  });
});
