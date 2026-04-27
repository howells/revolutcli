#!/usr/bin/env node
/**
 * MCP server wrapping the read-only Revolut surface.
 *
 * Exposes four tools:
 *   - list_accounts
 *   - get_balance
 *   - list_transactions
 *   - get_schema
 *
 * Plus an auth_status resource so an agent can detect that a human
 * bootstrap is needed before any of the above will work.
 *
 * The interactive `auth` command is not exposed as an MCP tool — it
 * requires a browser redirect that an MCP client cannot complete. The
 * agent should ask the human to run `revolutcli auth` in a terminal,
 * then re-try the failing tool.
 *
 * Errors thrown by the underlying functions (RevolutError) are translated
 * into structured MCP error envelopes via `tool_error()` so agents see the
 * same {code, is_retriable, recovery_hint} shape they get from the CLI.
 */

import {
  type McpToolResult,
  toMcpToolError,
  toMcpToolResult,
} from "@howells/cli/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listAccounts } from "./accounts.ts";
import { getAccessToken, loadCachedTokens, TOKEN_PATH } from "./auth.ts";
import {
  allBalances,
  balance,
  type TransactionsOptions,
  transactions,
} from "./commands.ts";
import { SCHEMA } from "./schema.ts";

/**
 * Wrap a successful payload as a `{ ok: true, data, ...extra }` MCP tool
 * envelope. Mirrors the CLI's stdout shape so an agent's parsing logic
 * works against either transport.
 */
function tool_ok(
  data: unknown,
  extra?: Record<string, unknown>,
): McpToolResult {
  return toMcpToolResult({ ok: true as const, data, ...(extra ?? {}) });
}

/**
 * Translate any thrown value to the MCP tool error envelope. Delegates to
 * `@howells/cli/mcp` so the shape stays identical to the CLI's stderr JSON.
 */
const tool_error = toMcpToolError;

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "revolutcli", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Read-only access to Revolut Business sub-accounts and transactions. " +
        "Authentication is bootstrapped out-of-band: if you receive AUTH_MISSING " +
        "or AUTH_EXPIRED, ask the human to run `revolutcli auth` in a terminal, " +
        "then retry. All tools return { ok, data, ... } on success and " +
        "{ ok: false, error, code, is_retriable, recovery_hint? } on failure.",
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List sub-accounts",
      description:
        "List all sub-accounts under the connection with balance, currency, and slug. " +
        "Use when you need to discover available account slugs. " +
        "Do NOT use to fetch a balance for one account — use get_balance instead.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const token = await getAccessToken();
        return tool_ok(await listAccounts(token));
      } catch (err) {
        return tool_error(err);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get balance",
      description:
        "Balance for one sub-account, or all sub-accounts when account is 'all' or omitted. " +
        "Use when you need current available funds. " +
        "Do NOT use to inspect transactions — use list_transactions for that.",
      inputSchema: {
        account: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "Sub-account slug (run list_accounts to discover). 'all' or omit for every sub-account. Example: 'anvil-cottage'.",
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ account }) => {
      try {
        const token = await getAccessToken();
        if (!account || account === "all") {
          return tool_ok(await allBalances(token), { account: "all" });
        }
        const data = await balance(token, account);
        return tool_ok(data, { account: data.slug });
      } catch (err) {
        return tool_error(err);
      }
    },
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description:
        "Transactions for a single sub-account within an optional date range. " +
        "Returns a paginated envelope; check meta.has_more to know if results were truncated. " +
        "When meta.has_more is true, set 'to' to the oldest result's date and re-call.",
      inputSchema: {
        account: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "Sub-account slug (run list_accounts to discover). Required. Example: 'anvil-cottage'.",
          ),
        from: z
          .string()
          .describe(
            "ISO 8601 lower bound (inclusive). Date or datetime. Example: '2026-04-01'.",
          )
          .optional(),
        to: z
          .string()
          .describe(
            "ISO 8601 upper bound (inclusive). Date or datetime. Example: '2026-04-30'.",
          )
          .optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .describe("Max results to return. Default 100, Revolut max 1000.")
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ account, from, to, limit }) => {
      try {
        const token = await getAccessToken();
        const opts: TransactionsOptions = {
          from,
          to,
          limit,
        };
        const page = await transactions(token, account, opts);
        return tool_ok(page.data, { account, meta: page.meta });
      } catch (err) {
        return tool_error(err);
      }
    },
  );

  server.registerTool(
    "get_schema",
    {
      title: "Get CLI schema",
      description:
        "Return the machine-readable description of every command, parameter, error code, and exit code. " +
        "Call once at session start to learn the surface. Do NOT call on every request.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => tool_ok(SCHEMA),
  );

  // Resource so an agent can check auth state without invoking a tool.
  server.registerResource(
    "auth_status",
    "revolut://auth/status",
    {
      title: "Auth status",
      description:
        "Whether tokens are cached and approximately when the access token expires.",
      mimeType: "application/json",
    },
    async () => {
      const cached = await loadCachedTokens();
      const status = cached
        ? {
            cached: true,
            cache_path: TOKEN_PATH,
            expires_in_minutes: Math.round(
              (cached.expires_at - Date.now()) / 60_000,
            ),
          }
        : {
            cached: false,
            cache_path: TOKEN_PATH,
            recovery_hint:
              "Run `revolutcli auth` in a terminal to bootstrap auth.",
          };
      return {
        contents: [
          {
            uri: "revolut://auth/status",
            mimeType: "application/json",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

// When invoked as a binary (revolutcli-mcp), connect to stdio.
// In tests we import buildServer() directly without running this block.
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  })().catch((err) => {
    process.stderr.write(`MCP server failed to start: ${err}\n`);
    process.exit(1);
  });
}
