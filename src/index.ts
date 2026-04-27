#!/usr/bin/env node
/**
 * revolutcli — agent-first CLI for Revolut Business.
 *
 * All commands write a single JSON envelope to stdout. Diagnostic prompts
 * (e.g. during `auth`) go to stderr so piping `revolutcli ... | jq` always
 * works.
 */

import { error, success } from "@howells/cli";
import { flag, getLimit, readResult } from "@howells/cli/args";
import { listAccounts } from "./accounts.ts";
import {
  exchangeCode,
  getAccessToken,
  promptForAuthCode,
  TOKEN_PATH,
} from "./auth.ts";
import {
  allBalances,
  balance,
  type TransactionsOptions,
  transactions,
} from "./commands.ts";
import { validateAccountName, validateDate } from "./validate.ts";

const command = process.argv[2];

async function getToken(cmd: string): Promise<string> {
  try {
    return await getAccessToken();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err), cmd);
  }
}

switch (command) {
  case "auth": {
    (async () => {
      try {
        const code = await promptForAuthCode();
        const tokens = await exchangeCode(code);
        const minutes = Math.round((tokens.expires_at - Date.now()) / 60_000);
        success(
          {
            cached_at: TOKEN_PATH,
            expires_in_minutes: minutes,
          },
          "auth",
        );
      } catch (err) {
        error(err instanceof Error ? err.message : String(err), "auth");
      }
    })();
    break;
  }

  case "accounts": {
    (async () => {
      try {
        const token = await getToken("accounts");
        const accounts = await listAccounts(token);
        readResult(
          "accounts",
          accounts as unknown as Record<string, unknown>[],
        );
      } catch (err) {
        error(err instanceof Error ? err.message : String(err), "accounts");
      }
    })();
    break;
  }

  case "balance": {
    (async () => {
      const acctName = flag("account");
      if (acctName && acctName !== "all") {
        validateAccountName(acctName, "balance");
      }
      try {
        const token = await getToken("balance");
        if (!acctName || acctName === "all") {
          const data = await allBalances(token);
          success(data, "balance", { account: "all" });
        } else {
          const data = await balance(token, acctName);
          success(data, "balance", { account: data.slug });
        }
      } catch (err) {
        error(err instanceof Error ? err.message : String(err), "balance");
      }
    })();
    break;
  }

  case "transactions": {
    (async () => {
      const acctName = flag("account");
      if (!acctName) {
        error(
          "transactions requires --account <slug>. Run 'revolutcli accounts' to list available sub-accounts.",
          "transactions",
        );
      }
      validateAccountName(acctName, "transactions");
      const from = flag("from");
      const to = flag("to");
      if (from) validateDate(from, "from", "transactions");
      if (to) validateDate(to, "to", "transactions");

      const options: TransactionsOptions = {
        from: from || undefined,
        to: to || undefined,
        limit: getLimit("transactions") ?? undefined,
      };

      try {
        const token = await getToken("transactions");
        const data = await transactions(token, acctName, options);
        readResult(
          "transactions",
          data as unknown as Record<string, unknown>[],
          { account: acctName },
        );
      } catch (err) {
        error(err instanceof Error ? err.message : String(err), "transactions");
      }
    })();
    break;
  }

  case "schema":
    success(
      {
        cli: "revolutcli",
        version: "0.1.0",
        description: "Agent-first CLI for Revolut Business",
        auth: {
          mechanism: "OAuth + JWT client assertion (RS256)",
          envVars: ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY_PATH"],
          tokenCache: TOKEN_PATH,
          setup: "Run 'revolutcli auth' once, then re-run any command.",
        },
        commands: {
          auth: {
            description:
              "One-time OAuth consent to obtain access + refresh tokens",
            params: {},
          },
          accounts: {
            description: "List sub-accounts under the connection",
            params: { fields: { type: "string" }, limit: { type: "integer" } },
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
              "Balance for one sub-account or all (default: all). Use --account <slug>.",
            params: { account: { type: "string" } },
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
              "Transactions for a sub-account. --account is required. Use --fields to limit token use.",
            params: {
              account: { type: "string" },
              from: { type: "string", format: "ISO 8601" },
              to: { type: "string", format: "ISO 8601" },
              limit: { type: "integer", description: "Default: 100" },
              fields: { type: "string" },
            },
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
          },
          accountsAll: { description: "List configured accounts (alias)" },
        },
        flags: {
          "--account":
            "Sub-account slug (run 'revolutcli accounts' to list). Use 'all' on balance to see every sub-account.",
          "--from": "ISO 8601 date — transactions on or after this",
          "--to": "ISO 8601 date — transactions on or before this",
          "--limit": "Max results (default 100)",
          "--fields": "Comma-separated field names to return",
        },
        readOnly: true,
      },
      "schema",
    );
    break;

  case "help":
  case "--help":
  case "-h":
    success(
      {
        usage:
          "revolutcli <command> [--account <slug>|all] [--from <date>] [--to <date>] [--limit N] [--fields ...]",
        commands: ["auth", "accounts", "balance", "transactions", "schema"],
        setup: [
          "1. Set REVOLUT_CLIENT_ID and REVOLUT_PRIVATE_KEY_PATH env vars.",
          "2. Run: revolutcli auth (one-time OAuth consent).",
          "3. Run any other command — tokens refresh automatically.",
        ],
        flags: {
          "--account":
            "Sub-account slug (run 'revolutcli accounts' to list). 'all' on balance to see every sub-account.",
          "--from": "ISO 8601 date — transactions on or after this",
          "--to": "ISO 8601 date — transactions on or before this",
          "--limit": "Max results",
          "--fields": "Comma-separated field names to return",
        },
        notes: [
          "Read-only by design — no transfers, no payment drafts, no counterparty management.",
        ],
      },
      "help",
    );
    break;

  case undefined:
    error("No command provided. Run 'revolutcli help' for usage.");
    break;

  default:
    error(`Unknown command: "${command}". Run 'revolutcli help' for usage.`);
    break;
}
