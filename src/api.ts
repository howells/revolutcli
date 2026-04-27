/** Base URL for the Revolut Business API. */
export const BASE_URL = "https://b2b.revolut.com";

/** Options for making a Revolut API request. */
export interface ApiOptions {
  /** Bearer access token (acquired via OAuth — see ./auth.ts). */
  token: string;
  /** API path, appended to {@link BASE_URL} (e.g. `/api/1.0/accounts`). */
  path: string;
  /** HTTP method. Default: GET. revolutcli is read-only so non-GET is rare. */
  method?: "GET";
  /** Query string parameters. Values are stringified and URL-encoded. */
  query?: Record<string, string | number | undefined>;
}

/**
 * Make an authenticated GET request to the Revolut Business API.
 *
 * @throws Error if the response status is not 2xx.
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

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Revolut API ${res.status}: ${text || res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return {} as T;
}

/**
 * Format a numeric balance as a currency string.
 *
 * @example formatAmount(12.34, "GBP") // "£12.34"
 */
export function formatAmount(amount: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency;
  return `${symbol}${amount.toFixed(2)}`;
}
