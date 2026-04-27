/**
 * Sub-account discovery.
 *
 * Unlike Starling (where each "account" is a separate connection with its own
 * token), Revolut Business returns multiple sub-accounts under one OAuth
 * connection. `--account <name>` filters those sub-accounts by name.
 *
 * We slugify Revolut account names ("Anvil Cottage" → "anvil-cottage") so they
 * can be passed cleanly on the command line.
 */

import { api } from "./api.ts";

export interface RevolutAccount {
  id: string;
  name: string;
  balance: number;
  currency: string;
  state: string;
  public: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResolvedAccount extends RevolutAccount {
  /** Slugified name used for --account matching. */
  slug: string;
}

/** Slugify a human account name so it survives shell argument parsing. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Fetch every sub-account under the connection and attach a slug. */
export async function listAccounts(token: string): Promise<ResolvedAccount[]> {
  const accounts = await api<RevolutAccount[]>({
    token,
    path: "/api/1.0/accounts",
  });
  return accounts.map((a) => ({ ...a, slug: slugify(a.name) }));
}

/**
 * Pick the sub-account matching `name`. Matches against slug exactly, then
 * by prefix. Returns null if `name` is undefined (caller decides what "no
 * filter" means — `balance` returns all, `transactions` returns an error).
 */
export function findAccount(
  accounts: ResolvedAccount[],
  name: string | undefined,
): ResolvedAccount | null {
  if (!name) return null;
  const key = slugify(name);
  const exact = accounts.find((a) => a.slug === key);
  if (exact) return exact;
  const prefix = accounts.find((a) => a.slug.startsWith(key));
  return prefix ?? null;
}
