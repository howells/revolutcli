# @howells/revolutcli

CLI for [Revolut Business](https://www.revolut.com/business) — balances, transactions, sub-accounts.

Designed for AI agents and automation. All output is structured JSON. Read-only by design.

## Install

```bash
npm install -g @howells/revolutcli
```

## Setup

revolutcli uses Revolut's OAuth + JWT client-assertion flow. You need:

1. A registered Revolut Business application (client_id).
2. An RSA private key whose public certificate is uploaded to that app.
3. Environment variables pointing at both.

```bash
export REVOLUT_CLIENT_ID="your-client-id"
export REVOLUT_PRIVATE_KEY_PATH="$HOME/.config/revolut/private.pem"

# One-time consent — visit the printed URL, authorize, paste back ?code=
revolutcli auth
```

Tokens are cached at `~/.revolutcli/tokens.json` (0600 perms) and refreshed automatically.

## Usage

```bash
revolutcli accounts                              # List sub-accounts
revolutcli balance                               # Balance for all sub-accounts
revolutcli balance --account all                 # Same — explicit
revolutcli balance --account anvil-cottage       # One sub-account

revolutcli transactions --account anvil-cottage  # Last 100 transactions
revolutcli transactions --account anvil-cottage \
  --from 2026-04-01 --to 2026-04-30 --limit 50

revolutcli schema                                # Schema introspection (for agents)
```

Always pair `transactions` with `--fields` to keep responses small:

```bash
revolutcli transactions --account anvil-cottage \
  --fields counterParty,amount,date,state --limit 20
```

## Output Format

```json
{
  "ok": true,
  "data": [ ... ],
  "command": "balance",
  "account": "all"
}
```

Errors:

```json
{
  "ok": false,
  "error": "No cached tokens. Run: revolutcli auth",
  "command": "balance"
}
```

## Sub-Accounts vs. Connections

Unlike Starling (one token per account), Revolut Business returns multiple sub-accounts under a single OAuth connection. revolutcli reflects that: one set of credentials, many sub-accounts addressable via slug.

## Read-Only

This CLI deliberately exposes only read endpoints (`balance`, `transactions`, `accounts`). Transfers, payment drafts, and counterparty management are out of scope — use the Revolut UI for those.

## License

MIT
