/**
 * Machine-readable description of the CLI surface.
 *
 * Returned by `revolutcli schema`. Agents read this once at session start to
 * learn what commands exist, what they accept, what they return, and how to
 * recover from errors.
 *
 * Kept in its own module so the descriptions are easy to maintain and easy
 * to reuse (e.g. by the MCP server in src/mcp.ts which projects each command
 * onto an MCP tool).
 */

import { TOKEN_PATH } from "./auth.ts";
import { DEFAULT_TRANSACTIONS_LIMIT } from "./commands.ts";

export const SCHEMA = {
  cli: "revolutcli",
  version: "0.1.0",
  description: "Agent-first CLI for Revolut Business",
  readOnly: true,
  envelope: {
    success: { ok: true, data: "any", command: "string", "...": "extras" },
    error: {
      ok: false,
      error: "string",
      code: "RevolutErrorCode",
      is_retriable: "boolean",
      command: "string",
      status: "number?",
      revolut_error_code: "number?",
      retry_after_seconds: "number?",
      recovery_hint: "string?",
      suggestions: "string[]?",
    },
    encoding:
      "Pretty-printed JSON (2-space indent) when stdout is a TTY; compact single-line JSON when piped. The `transactions --ndjson` flag emits one row per line plus a trailing { ok, meta } line for streaming consumers.",
  },
  exit_codes: {
    "0": "Success",
    "1": "Generic / internal error",
    "64": "Usage error (bad flags, missing required args)",
    "65": "Validation error (invalid input format)",
    "69": "Service unavailable (Revolut API 5xx, network, rate limited)",
    "77": "Permission denied (auth missing, expired, refused)",
    "78": "Not found (sub-account slug did not resolve)",
  },
  error_codes: {
    AUTH_MISSING:
      "No cached tokens. Ask the human to run `revolutcli auth`. Not retriable.",
    AUTH_EXPIRED:
      "Refresh-token rotation failed. Ask the human to re-run `revolutcli auth`. Not retriable.",
    AUTH_REFUSED:
      "Credentials rejected (HTTP 401). Re-run auth. Not retriable.",
    IP_NOT_WHITELISTED:
      "Revolut returned 403 with code 9002. The egress IP is not on the app's whitelist. Add it at https://business.revolut.com/settings/api → IP whitelist. Not retriable; re-auth will not help.",
    INSUFFICIENT_SCOPE:
      "HTTP 403 with no IP-whitelist signal — usually missing API scopes. Read the body for specifics. Not retriable.",
    VALIDATION:
      "Input failed format check (ISO date, slug shape, etc.). Fix and re-call. Not retriable.",
    ACCOUNT_NOT_FOUND:
      "Slug did not resolve. Read `suggestions[]` for valid slugs. Not retriable.",
    RATE_LIMITED:
      "HTTP 429. Wait `retry_after_seconds` (when present) and retry. Retriable.",
    API_ERROR:
      "Other HTTP failure. Retriable when `is_retriable: true` (i.e. 5xx).",
    NETWORK_ERROR: "Network failure reaching Revolut. Retriable.",
    USAGE: "Bad flags or missing required args. Surface to the human.",
    INTERNAL: "Bug. Surface to the human.",
  },
  revolut_error_codes: {
    "9002":
      "IP address not whitelisted. Routed to IP_NOT_WHITELISTED so agents don't conflate it with credential errors.",
  },
  auth: {
    mechanism: "OAuth 2.0 authorization code + JWT client assertion (RS256)",
    envVars: {
      REVOLUT_CLIENT_ID:
        "Client ID from https://business.revolut.com/settings/api",
      REVOLUT_PRIVATE_KEY_PATH:
        "Absolute path to RSA private key whose public cert is registered with Revolut",
    },
    tokenCache: TOKEN_PATH,
    setup:
      "Run 'revolutcli auth' once interactively, OR 'revolutcli auth --code <code>' if you can capture the redirect non-interactively.",
    bootstrap_required: true,
    note: "After initial auth, refresh is automatic. Tokens are cached at 0600 perms.",
  },
  commands: {
    auth: {
      description:
        "One-time OAuth consent to obtain access + refresh tokens. Use when starting up for the first time, or after seeing AUTH_EXPIRED. Do NOT use to read data — it only writes the token cache.",
      params: {
        code: {
          type: "string",
          description:
            "OAuth redirect 'code' value. When omitted, the CLI prompts via stdin/stderr.",
          example: "oa_sandbox_xxxxxxxxxxxxx",
          required: false,
        },
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
      side_effects: ["writes ~/.revolutcli/tokens.json"],
    },
    accounts: {
      description:
        "List all sub-accounts under the connection with balance, currency, and slug. Use when you need to discover available --account slugs. Do NOT use to fetch a balance for a single account — use 'balance --account <slug>' which is cheaper for that case.",
      params: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
      fields: [
        "id",
        "slug",
        "name",
        "balance",
        "currency",
        "state",
        "public",
        "created_at",
        "updated_at",
      ],
    },
    balance: {
      description:
        "Balance for one sub-account, or all sub-accounts when --account is 'all' or omitted. Use when you need current available funds. Do NOT use to inspect transactions — use 'transactions' for that.",
      params: {
        account: {
          type: "string",
          description:
            "Sub-account slug (run 'revolutcli accounts' to list). Pass 'all' or omit to see every sub-account.",
          example: "anvil-cottage",
          required: false,
        },
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      fields: [
        "id",
        "account",
        "slug",
        "balance",
        "formatted",
        "currency",
        "state",
      ],
    },
    transactions: {
      description:
        "Transactions for a single sub-account within an optional date range. Use when reviewing recent activity, reconciling, or categorising spend. Always pair with --fields to keep payload small. Returns a paginated envelope; check meta.has_more to know if results were truncated.",
      params: {
        account: {
          type: "string",
          description:
            "Sub-account slug (run 'revolutcli accounts' to list). Required.",
          example: "anvil-cottage",
          required: true,
        },
        from: {
          type: "string",
          format: "ISO 8601",
          description: "Lower bound (inclusive). Date or datetime.",
          example: "2026-04-01",
          required: false,
        },
        to: {
          type: "string",
          format: "ISO 8601",
          description: "Upper bound (inclusive). Date or datetime.",
          example: "2026-04-30",
          required: false,
        },
        limit: {
          type: "integer",
          description: `Max results to return. Default ${DEFAULT_TRANSACTIONS_LIMIT}, Revolut max 1000.`,
          example: 50,
          required: false,
        },
        fields: {
          type: "string",
          description:
            "Comma-separated subset of: id, type, state, date, amount, formatted, currency, counterParty, reference, category.",
          example: "counterParty,amount,date",
          required: false,
        },
        ndjson: {
          type: "boolean",
          description:
            "Emit one JSON object per line (NDJSON) instead of a single envelope. Final line is { ok: true, meta: {...} } so consumers can still detect truncation.",
          required: false,
        },
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      fields: [
        "id",
        "type",
        "state",
        "date",
        "amount",
        "formatted",
        "currency",
        "counterParty",
        "reference",
        "category",
      ],
      pagination: {
        meta_field: "meta",
        shape: { returned: "number", limit: "number", has_more: "boolean" },
        next_page_strategy:
          "When meta.has_more is true, set --to to the oldest result's date and re-call.",
      },
    },
    schema: {
      description:
        "Machine-readable description of every command, parameter, error code, and exit code. Use this once at session start to learn the surface — do NOT call it on every request.",
      params: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    version: {
      description:
        "Print the CLI name and version as a JSON envelope. Use to verify which release is installed.",
      params: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  },
  flags: {
    "--account":
      "Sub-account slug (run 'revolutcli accounts' to list). Use 'all' on balance to see every sub-account.",
    "--from": "ISO 8601 date — transactions on or after this",
    "--to": "ISO 8601 date — transactions on or before this",
    "--limit": "Max results (default 100)",
    "--fields": "Comma-separated field names to return",
    "--ndjson": "(transactions only) emit NDJSON instead of a wrapped envelope",
    "--code": "Authorization code for non-interactive `auth` (skips prompt)",
  },
} as const;

export const HELP = {
  usage:
    "revolutcli <command> [--account <slug>|all] [--from <date>] [--to <date>] [--limit N] [--fields ...] [--ndjson]",
  commands: [
    "auth",
    "accounts",
    "balance",
    "transactions",
    "schema",
    "version",
  ],
  setup: [
    "1. Set REVOLUT_CLIENT_ID and REVOLUT_PRIVATE_KEY_PATH env vars.",
    "2. Run: revolutcli auth (one-time OAuth consent). Pass --code <value> to skip the stdin prompt.",
    "3. Run any other command — tokens refresh automatically.",
  ],
  flags: {
    "--account":
      "Sub-account slug (run 'revolutcli accounts' to list). 'all' on balance to see every sub-account.",
    "--from": "ISO 8601 date — transactions on or after this",
    "--to": "ISO 8601 date — transactions on or before this",
    "--limit": "Max results",
    "--fields": "Comma-separated field names to return",
    "--ndjson": "(transactions only) emit NDJSON instead of a wrapped envelope",
    "--code": "Authorization code for non-interactive `auth`",
  },
  notes: [
    "Read-only by design — no transfers, no payment drafts, no counterparty management.",
    "All errors are JSON: { ok: false, error, code, is_retriable, recovery_hint? }.",
    "JSON is pretty-printed when stdout is a TTY, compact when piped.",
    "Run 'revolutcli schema' for the full machine-readable surface description.",
  ],
} as const;
