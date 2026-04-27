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

/** Revolut-specific machine-readable error codes we route on. */
const REVOLUT_CODE = {
  IP_NOT_WHITELISTED: 9002,
} as const;

interface ParsedRevolutError {
  /** Numeric code from Revolut's body, when present. */
  revolut_error_code?: number;
  /** Human message from Revolut's body, when present. Fallback to body text. */
  detail: string;
}

/**
 * Revolut's 4xx and 5xx responses are usually JSON: `{ message, code }`. We
 * parse them so agents can route on the vendor code instead of grepping the
 * message string. Falls back to the raw body when not parseable.
 */
export function parseRevolutErrorBody(body: string): ParsedRevolutError {
  if (!body) return { detail: "" };
  try {
    const parsed = JSON.parse(body) as { message?: unknown; code?: unknown };
    const detail =
      typeof parsed.message === "string" && parsed.message.length > 0
        ? parsed.message
        : body;
    const revolut_error_code =
      typeof parsed.code === "number" ? parsed.code : undefined;
    return { detail, revolut_error_code };
  } catch {
    return { detail: body };
  }
}

function classifyHttpError(res: Response, body: string): RevolutError {
  const status = res.status;
  const { detail, revolut_error_code } = parseRevolutErrorBody(body);
  const message = `Revolut API ${status}: ${detail || res.statusText}`;

  // 403 with code 9002 is specifically an IP-whitelist policy denial — not
  // a credential problem, so re-auth doesn't help. Route to its own code.
  if (
    status === 403 &&
    revolut_error_code === REVOLUT_CODE.IP_NOT_WHITELISTED
  ) {
    return new RevolutError(message, {
      code: "IP_NOT_WHITELISTED",
      status,
      revolut_error_code,
      is_retriable: false,
      recovery_hint:
        "This IP is not on the Revolut Business app whitelist. Add it at https://business.revolut.com/settings/api → your app → IP whitelist (or disable the whitelist). Re-running auth will not help.",
    });
  }

  // Plain 401: token expired or invalid signature — re-auth helps.
  if (status === 401) {
    return new RevolutError(message, {
      code: "AUTH_REFUSED",
      status,
      revolut_error_code,
      is_retriable: false,
      recovery_hint: "Re-run: revolutcli auth",
    });
  }

  // 403 without a known vendor code: most often missing scope on the app.
  if (status === 403) {
    return new RevolutError(message, {
      code: "INSUFFICIENT_SCOPE",
      status,
      revolut_error_code,
      is_retriable: false,
      recovery_hint:
        "Verify the Revolut app has the required scopes (READ for accounts/transactions). Check the response body for the specific issue.",
    });
  }

  if (status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    return new RevolutError(message, {
      code: "RATE_LIMITED",
      status,
      revolut_error_code,
      is_retriable: true,
      retry_after_seconds: retryAfter,
      recovery_hint: retryAfter
        ? `Wait ${retryAfter}s and retry.`
        : "Wait and retry.",
    });
  }

  if (status >= 500) {
    return new RevolutError(message, {
      code: "API_ERROR",
      status,
      revolut_error_code,
      is_retriable: true,
      recovery_hint: "Transient upstream failure. Retry with backoff.",
    });
  }

  return new RevolutError(message, {
    code: "API_ERROR",
    status,
    revolut_error_code,
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
