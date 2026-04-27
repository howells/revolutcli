# @howells/revolutcli — Agent Guide

CLI for Revolut Business. Read-only. OAuth + JWT client assertion auth. One connection, many sub-accounts. Also exposes an MCP server (`revolutcli-mcp`) wrapping the same tools.

## Quick Start

```bash
# One-time setup
export REVOLUT_CLIENT_ID="..."
export REVOLUT_PRIVATE_KEY_PATH="$HOME/.config/revolut/private.pem"
revolutcli auth                   # opens consent URL, paste the redirect ?code=
# OR non-interactively (you've captured the code yourself):
revolutcli auth --code "oa_..."

# All balances
revolutcli balance --account all

# Per sub-account
revolutcli balance --account anvil-cottage

# Transactions (always use --fields)
revolutcli transactions --account anvil-cottage \
  --fields counterParty,amount,date \
  --from 2026-04-01 --limit 20

# Schema introspection — call once at session start
revolutcli schema
```

## Permission Boundaries

Commands sorted by what an agent should and shouldn't run unattended:

- **Always (read-only, no side effects):**
  - `revolutcli accounts`
  - `revolutcli balance [--account <slug>|all]`
  - `revolutcli transactions --account <slug> [--from ...] [--to ...] [--limit N] [--fields ...]`
  - `revolutcli schema`
  - `revolutcli help`
- **Ask first (writes to disk, opens browser):**
  - `revolutcli auth` — writes `~/.revolutcli/tokens.json` (0600). Interactive unless `--code` is supplied.
- **Never (not exposed by design):**
  - Any transfer, payment draft, or counterparty mutation. Use the Revolut UI.

## Invariants

- **Always use `--fields`** on transactions — Revolut payloads are deeply nested otherwise.
- **`transactions` requires `--account`** — Revolut's transactions endpoint is connection-wide and we filter by account_id.
- **Use `--account all`** with `balance` to see every sub-account.
- **All output is JSON.** Success: `{ok: true, data, command, ...}`. Errors: `{ok: false, error, code, is_retriable, recovery_hint?, status?, retry_after_seconds?, suggestions?}`.
- **Read-only by design** — no transfers, no payment drafts, no counterparty management. Use the Revolut UI for write operations.
- **Tokens cache at `~/.revolutcli/tokens.json`** (0600). Refresh is automatic.
- **Pagination** — `transactions` returns `meta.has_more`. When true, set `--to` to the oldest result's `date` and re-call.

## Sub-Account Resolution

Sub-accounts are discovered from the API, not env vars. Names are slugified for CLI use:

- `Anvil Cottage` → `--account anvil-cottage`
- `Cathcart Phase 1` → `--account cathcart-phase-1`
- `Revolut [GBP] [Thanet]` → `--account revolut-gbp-thanet`

**Edge cases the slug resolver handles:**

- **Duplicate names**: two accounts both called `Main` (one EUR, one USD) become `main-eur` and `main-usd`. Currency is appended to all colliding members.
- **Missing name**: Revolut sometimes returns accounts with no `name` field. They become `unnamed-<currency>` (e.g. `unnamed-gbp`).
- **Same currency collisions**: in the rare case two accounts share both a name and a currency, the second gets a 6-char id suffix (`main-gbp-bbbbbb`).

Run `revolutcli accounts` to see the canonical list of slugs available right now — never hardcode them.

## Transaction Fields

Available for `--fields`: `id`, `type`, `state`, `date`, `amount`, `formatted`, `currency`, `counterParty`, `reference`, `category`

## Error Recovery

Every error envelope carries a stable `code` and `is_retriable` boolean. Switch on `code`, not on the message string. The `revolut_error_code` field surfaces Revolut's own numeric error code from the response body (e.g. `9002` for IP-whitelist violations) so agents can route on vendor codes when needed.

| Code | Exit | Retriable | What to do |
|---|---|---|---|
| `AUTH_MISSING` | 77 | no | Ask the human to run `revolutcli auth`. Do not retry. |
| `AUTH_EXPIRED` | 77 | no | Refresh-token rotation failed. Ask the human to re-run `revolutcli auth`. |
| `AUTH_REFUSED` | 77 | no | HTTP 401. Credentials rejected. Verify `REVOLUT_CLIENT_ID` + private key, then re-run `auth`. |
| `IP_NOT_WHITELISTED` | 77 | no | HTTP 403 with Revolut code 9002. **Re-auth will not fix this.** Tell the human to add the egress IP to the Revolut Business app whitelist (Business Portal → Settings → API → app → IP whitelist). |
| `INSUFFICIENT_SCOPE` | 77 | no | HTTP 403 without IP-whitelist signal. Usually missing API scope. Tell the human to check the app's permissions. |
| `USAGE` | 64 | no | Surface the message; the call is malformed. |
| `VALIDATION` | 65 | no | Input failed format check (ISO date, slug shape). Fix and re-call. |
| `ACCOUNT_NOT_FOUND` | 78 | no | Read `suggestions[]` for valid slugs. Pick one and retry. |
| `RATE_LIMITED` | 69 | yes | Wait `retry_after_seconds` (when present) and retry. |
| `API_ERROR` | 69 | varies | If `is_retriable: true` (5xx), retry with backoff. If false (4xx), surface. |
| `NETWORK_ERROR` | 69 | yes | Retry with backoff. |
| `INTERNAL` | 1 | no | Bug. Surface to the human. |

## Common Workflows

### Daily balance check
```bash
revolutcli balance --account all --fields slug,formatted,currency
```

### Recent spending on a single sub-account
```bash
revolutcli transactions --account anvil-cottage \
  --from 2026-04-01 --fields counterParty,amount,date --limit 20
```

### Streaming many transactions (NDJSON)
```bash
# One JSON object per line; trailing line carries { ok, meta }.
revolutcli transactions --account phaia --from 2026-01-01 --limit 1000 --ndjson \
  | jq -c 'select(.amount and .amount < 0)'
```

### Paging through more than 1000 transactions
```bash
# First page
revolutcli transactions --account anvil-cottage --from 2026-01-01 --limit 1000
# If meta.has_more is true, set --to to the oldest result's date and re-call.
```

### Re-auth after refresh-token expiry
```bash
revolutcli auth
```

### Verify version
```bash
revolutcli version | jq -r '.data.version'
```

## MCP

Install once, then point any MCP-aware client at the bundled `.mcp.json` or invoke `revolutcli-mcp` directly over stdio.

Tools exposed (all `readOnlyHint: true`, `idempotentHint: true`):
- `list_accounts`
- `get_balance`
- `list_transactions`
- `get_schema`

Auth bootstrap is out-of-band: if a tool returns `AUTH_MISSING` or `AUTH_EXPIRED`, ask the human to run `revolutcli auth` in a terminal, then retry.

## Development

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run (unit + MCP + subprocess routing)
pnpm build         # tsc into dist/
pnpm dev <args>    # tsx src/index.ts <args>
pnpm dev:mcp       # tsx src/mcp.ts (stdio MCP server)
pnpm lint          # howells-lint
pnpm format        # howells-format
```
