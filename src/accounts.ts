/**
 * Sub-account discovery.
 *
 * Unlike Starling (where each "account" is a separate connection with its own
 * token), Revolut Business returns multiple sub-accounts under one OAuth
 * connection. `--account <name>` filters those sub-accounts by name.
 *
 * We slugify Revolut account names ("Anvil Cottage" → "anvil-cottage") so they
 * can be passed cleanly on the command line. Two real-world cases the
 * slugifier handles:
 *
 *   1. Some Revolut accounts have no `name` field at all (typically the
 *      default unnamed pocket). We fall back to `unnamed-<currency>`.
 *   2. Two accounts can legitimately share a name (e.g. both EUR and USD
 *      currency pockets are called "Main"). We disambiguate collisions by
 *      appending `-<currency>` (and `-<short_id>` if even that collides).
 */

import { api } from "./api.ts";

export interface RevolutAccount {
  id: string;
  /** Optional — Revolut sometimes returns accounts with no `name` field. */
  name?: string;
  balance: number;
  currency: string;
  state: string;
  public: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResolvedAccount extends RevolutAccount {
  /** Slugified name used for --account matching. Always non-empty + unique. */
  slug: string;
  /** Display name — guaranteed string, falls back when API omits `name`. */
  name: string;
}

/** Slugify a string so it survives shell argument parsing. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Fetch every sub-account under the connection and attach a unique slug.
 *
 * Slug uniqueness is guaranteed: collisions get disambiguated by currency,
 * then by id suffix as a last resort.
 */
export async function listAccounts(token: string): Promise<ResolvedAccount[]> {
  const accounts = await api<RevolutAccount[]>({
    token,
    path: "/api/1.0/accounts",
  });
  return resolveSlugs(accounts);
}

/** Pure: assign unique slugs to a list of Revolut accounts. Exported for tests. */
export function resolveSlugs(accounts: RevolutAccount[]): ResolvedAccount[] {
  // Step 1 — base slug from name, or `unnamed-<currency>` if Revolut omitted name.
  const withBase = accounts.map((a) => {
    const displayName =
      a.name && a.name.trim().length > 0
        ? a.name
        : `unnamed-${a.currency.toUpperCase()}`;
    const baseSlug =
      a.name && a.name.trim().length > 0
        ? slugify(a.name)
        : slugify(`unnamed ${a.currency}`);
    return { account: a, displayName, baseSlug };
  });

  // Step 2 — count occurrences of each base slug.
  const counts = new Map<string, number>();
  for (const entry of withBase) {
    counts.set(entry.baseSlug, (counts.get(entry.baseSlug) ?? 0) + 1);
  }

  // Step 3 — for collisions, disambiguate by currency. If still colliding,
  // append a short id suffix (last 6 chars of the UUID).
  const finalSlugs = new Set<string>();
  return withBase.map(({ account, displayName, baseSlug }) => {
    let slug = baseSlug;
    if ((counts.get(baseSlug) ?? 0) > 1) {
      slug = `${baseSlug}-${account.currency.toLowerCase()}`;
      if (finalSlugs.has(slug)) {
        slug = `${slug}-${account.id.replace(/-/g, "").slice(-6)}`;
      }
    }
    finalSlugs.add(slug);
    return { ...account, name: displayName, slug };
  });
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
