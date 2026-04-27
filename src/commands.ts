import { findAccount, listAccounts, type ResolvedAccount } from "./accounts.ts";
import { api, formatAmount } from "./api.ts";

export interface BalanceRow {
  id: string;
  account: string;
  slug: string;
  balance: number;
  formatted: string;
  currency: string;
  state: string;
}

function toBalanceRow(a: ResolvedAccount): BalanceRow {
  return {
    id: a.id,
    account: a.name,
    slug: a.slug,
    balance: a.balance,
    formatted: formatAmount(a.balance, a.currency),
    currency: a.currency,
    state: a.state,
  };
}

/**
 * Return balances for every sub-account under the connection.
 * Mirrors `starlingcli balance --account all`.
 */
export async function allBalances(token: string): Promise<BalanceRow[]> {
  const accounts = await listAccounts(token);
  return accounts.map(toBalanceRow);
}

/** Return the balance for a single sub-account selected by slug. */
export async function balance(
  token: string,
  accountName: string,
): Promise<BalanceRow> {
  const accounts = await listAccounts(token);
  const match = findAccount(accounts, accountName);
  if (!match) {
    throw new Error(
      `No sub-account "${accountName}". Available: ${
        accounts.map((a) => a.slug).join(", ") || "none"
      }.`,
    );
  }
  return toBalanceRow(match);
}

export interface RevolutTransactionLeg {
  leg_id: string;
  account_id: string;
  counterparty?: { account_id?: string; account_type?: string; id?: string };
  amount: number;
  currency: string;
  description?: string;
  balance?: number;
}

export interface RevolutTransaction {
  id: string;
  type: string;
  state: string;
  reason_code?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  reference?: string;
  legs: RevolutTransactionLeg[];
  merchant?: { name?: string; city?: string; category_code?: string };
}

export interface TransactionRow {
  id: string;
  type: string;
  state: string;
  date: string;
  amount: number;
  formatted: string;
  currency: string;
  counterParty: string;
  reference: string;
  category: string;
}

function pickCounterParty(tx: RevolutTransaction, accountId: string): string {
  if (tx.merchant?.name) return tx.merchant.name;
  const otherLeg = tx.legs.find((l) => l.account_id !== accountId);
  if (otherLeg?.description) return otherLeg.description;
  const ownLeg = tx.legs.find((l) => l.account_id === accountId);
  return ownLeg?.description ?? "";
}

function toTransactionRow(
  tx: RevolutTransaction,
  accountId: string,
): TransactionRow {
  const ownLeg = tx.legs.find((l) => l.account_id === accountId) ?? tx.legs[0];
  const amount = ownLeg?.amount ?? 0;
  const currency = ownLeg?.currency ?? "";
  return {
    id: tx.id,
    type: tx.type,
    state: tx.state,
    date: tx.completed_at ?? tx.created_at,
    amount,
    formatted: formatAmount(amount, currency),
    currency,
    counterParty: pickCounterParty(tx, accountId),
    reference: tx.reference ?? "",
    category: tx.merchant?.category_code ?? "",
  };
}

export interface TransactionsOptions {
  /** ISO 8601 date — only return transactions on or after this. */
  from?: string;
  /** ISO 8601 date — only return transactions on or before this. */
  to?: string;
  /** Cap the number of results returned. Revolut max is 1000. */
  limit?: number;
}

/**
 * List transactions for a single sub-account. Revolut's transactions endpoint
 * is connection-wide, so we resolve the slug to an account_id and filter.
 */
export async function transactions(
  token: string,
  accountName: string,
  options: TransactionsOptions = {},
): Promise<TransactionRow[]> {
  const accounts = await listAccounts(token);
  const match = findAccount(accounts, accountName);
  if (!match) {
    throw new Error(
      `No sub-account "${accountName}". Available: ${
        accounts.map((a) => a.slug).join(", ") || "none"
      }.`,
    );
  }

  const txs = await api<RevolutTransaction[]>({
    token,
    path: "/api/1.0/transactions",
    query: {
      account: match.id,
      from: options.from,
      to: options.to,
      count: options.limit ?? 100,
    },
  });

  return txs.map((tx) => toTransactionRow(tx, match.id));
}
