import {
  CliError,
  classifyHttpError,
  classifyNetworkError,
} from "@howells/cli";

/** Base URL for the Revolut Business API. */
export const BASE_URL = "https://b2b.revolut.com";

/** Options for making a Revolut API request. */
export interface ApiOptions {
  /** Bearer access token (acquired via OAuth — see ./auth.ts). */
  token: string;
  /** API path, appended to {@link BASE_URL} (e.g. `/api/1.0/accounts`). */
  path: string;
  method?: "GET";
  /** Query string parameters. Values are stringified and URL-encoded. */
  query?: Record<string, string | number | undefined>;
}

/**
 * Make an authenticated GET request to the Revolut Business API.
 *
 * @throws CliError with structured `code`, `status`, `is_retriable`, and
 *   recovery hints. Uses {@link classifyHttpError} from @howells/cli plus a
 *   Revolut-specific override for the `9002` IP-whitelist code (which
 *   re-auth cannot fix).
 */
export async function api<T>({
  token,
  path,
  method = "GET",
  query,
}: ApiOptions): Promise<T> {
  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw classifyNetworkError(err, { vendor: "Revolut" });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw classifyHttpError(res, text, {
      vendor: "Revolut",
      authRecoveryHint: "Re-run: revolutcli auth",
      scopeRecoveryHint:
        "Verify the Revolut app has the required scopes (READ for accounts/transactions). Check the response body for the specific issue.",
      override(status, parsed) {
        // 403 with code 9002 = IP-whitelist policy denial. Re-auth doesn't
        // help — only adding the egress IP to the app's whitelist does.
        if (
          status === 403 &&
          parsed.vendorCode === REVOLUT_CODE.IP_NOT_WHITELISTED
        ) {
          return new CliError(
            `Revolut API ${status}: ${parsed.detail || res.statusText}`,
            {
              code: "IP_NOT_WHITELISTED",
              status,
              is_retriable: false,
              recovery_hint:
                "This IP is not on the Revolut Business app whitelist. Add it at https://business.revolut.com/settings/api → your app → IP whitelist (or disable the whitelist). Re-running auth will not help.",
              extra: { revolut_error_code: parsed.vendorCode },
            },
          );
        }
        return undefined;
      },
    });
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return {} as T;
}

/** Revolut-specific machine-readable error codes we route on. */
const REVOLUT_CODE = {
  IP_NOT_WHITELISTED: 9002,
} as const;

/**
 * Re-export of @howells/cli's `parseVendorErrorBody` under the old name so
 * existing tests continue to import it from this module.
 */
export { parseVendorErrorBody as parseRevolutErrorBody } from "@howells/cli";

/**
 * Format a numeric balance as a currency string.
 *
 * @example formatAmount(12.34, "GBP") // "£12.34"
 */
export function formatAmount(amount: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency;
  return `${symbol}${amount.toFixed(2)}`;
}
