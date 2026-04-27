#!/usr/bin/env node
/**
 * revolutcli — agent-first CLI for Revolut Business.
 *
 * All commands write a single JSON envelope to stdout. Diagnostic prompts
 * (e.g. during `auth`) go to stderr so piping `revolutcli ... | jq` always
 * works.
 *
 * Errors carry `code`, `is_retriable`, optional `status`, optional
 * `retry_after_seconds`, and optional `suggestions`/`recovery_hint`. Exit
 * codes follow sysexits (64 usage, 65 data, 69 unavailable, 77 noperm,
 * 78 not-found) — see `revolutcli schema` for the full table.
 */

import { success } from "@howells/cli";
import { flag, getLimit } from "@howells/cli/args";
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
import { RevolutError, reportError } from "./errors.ts";
import { HELP, SCHEMA } from "./schema.ts";
import { validateAccountName, validateDate } from "./validate.ts";

async function getToken(cmd: string): Promise<string> {
  try {
    return await getAccessToken();
  } catch (err) {
    reportError(err, cmd);
  }
}

const command = process.argv[2];

switch (command) {
  case "auth": {
    (async () => {
      try {
        const codeFlag = flag("code");
        const code = codeFlag ? codeFlag.trim() : await promptForAuthCode();
        if (!code) {
          throw new RevolutError("No authorization code provided", {
            code: "USAGE",
            is_retriable: false,
            recovery_hint:
              "Pass --code <value> or paste the code into stdin when prompted.",
          });
        }
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
        reportError(err, "auth");
      }
    })();
    break;
  }

  case "accounts": {
    (async () => {
      try {
        const token = await getToken("accounts");
        const accounts = await listAccounts(token);
        success(accounts, "accounts");
      } catch (err) {
        reportError(err, "accounts");
      }
    })();
    break;
  }

  case "balance": {
    (async () => {
      const acctName = flag("account");
      try {
        if (acctName && acctName !== "all") {
          validateAccountName(acctName, "balance");
        }
        const token = await getToken("balance");
        if (!acctName || acctName === "all") {
          const data = await allBalances(token);
          success(data, "balance", { account: "all" });
        } else {
          const data = await balance(token, acctName);
          success(data, "balance", { account: data.slug });
        }
      } catch (err) {
        reportError(err, "balance");
      }
    })();
    break;
  }

  case "transactions": {
    (async () => {
      const acctName = flag("account");
      try {
        if (!acctName) {
          throw new RevolutError(
            "transactions requires --account <slug>. Run 'revolutcli accounts' to list available sub-accounts.",
            {
              code: "USAGE",
              is_retriable: false,
              recovery_hint: "Pass --account <slug>.",
            },
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

        const token = await getToken("transactions");
        const page = await transactions(token, acctName, options);
        success(page.data, "transactions", {
          account: acctName,
          meta: page.meta,
        });
      } catch (err) {
        reportError(err, "transactions");
      }
    })();
    break;
  }

  case "schema":
    success(SCHEMA, "schema");
    break;

  case "help":
  case "--help":
  case "-h":
    success(HELP, "help");
    break;

  case undefined:
    reportError(
      new RevolutError(
        "No command provided. Run 'revolutcli help' for usage.",
        {
          code: "USAGE",
          is_retriable: false,
          recovery_hint: "Run: revolutcli help",
        },
      ),
    );
    break;

  default:
    reportError(
      new RevolutError(
        `Unknown command: "${command}". Run 'revolutcli help' for usage.`,
        {
          code: "USAGE",
          is_retriable: false,
          recovery_hint: "Run: revolutcli help",
          suggestions: [
            "auth",
            "accounts",
            "balance",
            "transactions",
            "schema",
          ],
        },
      ),
    );
    break;
}
