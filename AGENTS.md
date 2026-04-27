# @howells/revolutcli — Agent Guide

CLI for Revolut Business. Read-only. OAuth + JWT client assertion auth. One connection, many sub-accounts.

## Quick Start

```bash
# One-time setup
export REVOLUT_CLIENT_ID="..."
export REVOLUT_PRIVATE_KEY_PATH="$HOME/.config/revolut/private.pem"
revolutcli auth   # opens consent URL, paste the redirect ?code=

# All balances
revolutcli balance --account all

# Per sub-account
revolutcli balance --account anvil-cottage

# Transactions (always use --fields)
revolutcli transactions --account anvil-cottage \
  --fields counterParty,amount,date \
  --from 2026-04-01 --limit 20

# Schema introspection
revolutcli schema
```

## Invariants

- **Always use `--fields`** on transactions — Revolut payloads are deeply nested otherwise.
- **`transactions` requires `--account`** — Revolut's transactions endpoint is connection-wide and we filter by account_id.
- **Use `--account all`** with `balance` to see every sub-account.
- **All output is JSON** with `{ok, data, error, command, account}` envelope.
- **Read-only by design** — no transfers, no payment drafts, no counterparty management. Use the Revolut UI for write operations.
- **Tokens cache at `~/.revolutcli/tokens.json`** (0600). Refresh is automatic.

## Sub-Account Resolution

Sub-accounts are discovered from the API, not env vars. Names are slugified for CLI use:

- `Anvil Cottage` → `--account anvil-cottage`
- `Cathcart Phase 1` → `--account cathcart-phase-1`
- `Revolut [GBP] [Thanet]` → `--account revolut-gbp-thanet`

Run `revolutcli accounts` to see the canonical list of slugs available right now.

## Transaction Fields

Available for `--fields`: `id`, `type`, `state`, `date`, `amount`, `formatted`, `currency`, `counterParty`, `reference`, `category`

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

### Re-auth after refresh-token expiry
```bash
revolutcli auth
```
