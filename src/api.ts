import { RevolutError } from "./errors.ts";

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
 * @throws RevolutError with structured status + retriability fields agents
 *   can act on without parsing the message string.
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
    throw new RevolutError(
      `Network error contacting Revolut: ${err instanceof Error ? err.message : String(err)}`,
      {
        code: "NETWORK_ERROR",
        is_retriable: true,
        recovery_hint: "Check connectivity and retry.",
        cause: err,
      },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw classifyHttpError(res, text);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return {} as T;
}

function classifyHttpError(res: Response, body: string): RevolutError {
  const status = res.status;
  const detail = body || res.statusText;

  if (status === 401 || status === 403) {
    return new RevolutError(`Revolut API ${status}: ${detail}`, {
      code: "AUTH_REFUSED",
      status,
      is_retriable: false,
      recovery_hint: "Re-run: revolutcli auth",
    });
  }

  if (status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    return new RevolutError(`Revolut API 429: ${detail}`, {
      code: "RATE_LIMITED",
      status,
      is_retriable: true,
      retry_after_seconds: retryAfter,
      recovery_hint: retryAfter
        ? `Wait ${retryAfter}s and retry.`
        : "Wait and retry.",
    });
  }

  if (status >= 500) {
    return new RevolutError(`Revolut API ${status}: ${detail}`, {
      code: "API_ERROR",
      status,
      is_retriable: true,
      recovery_hint: "Transient upstream failure. Retry with backoff.",
    });
  }

  return new RevolutError(`Revolut API ${status}: ${detail}`, {
    code: "API_ERROR",
    status,
    is_retriable: false,
  });
}

/** Parse a Retry-After header (seconds form only — HTTP-date form is rare). */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
