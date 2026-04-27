/**
 * Structured error envelope for agent consumers.
 *
 * Wraps @howells/cli's plain `error()` with extra fields agents need to
 * decide what to do next: is this transient, what HTTP status produced it,
 * what should the agent try, and which exit code maps to which class of
 * failure.
 *
 * The envelope is a superset of @howells/cli's CliResult, so existing
 * consumers that only read `ok` and `error` continue to work.
 */

/**
 * Stable error codes that agents can switch on. Strings, not numbers, so they
 * survive serialization and grep.
 */
export type RevolutErrorCode =
  | "AUTH_MISSING"
  | "AUTH_EXPIRED"
  | "AUTH_REFUSED"
  | "IP_NOT_WHITELISTED"
  | "INSUFFICIENT_SCOPE"
  | "VALIDATION"
  | "ACCOUNT_NOT_FOUND"
  | "RATE_LIMITED"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "USAGE"
  | "INTERNAL";

/** Sysexits-aligned exit codes — agent orchestrators can switch on these. */
export const EXIT = {
  OK: 0,
  GENERIC: 1,
  USAGE: 64, // EX_USAGE — bad flags, missing required args
  DATAERR: 65, // EX_DATAERR — input failed validation
  NOPERM: 77, // EX_NOPERM — auth missing or rejected
  UNAVAILABLE: 69, // EX_UNAVAILABLE — Revolut API down or rate-limited
  NOTFOUND: 78, // EX_CONFIG-adjacent — slug/account didn't resolve
} as const;

export interface RevolutErrorOptions {
  /** Domain code agents can switch on. */
  code: RevolutErrorCode;
  /** Stable HTTP-style status (when applicable). Mirrors RFC 9457 `status`. */
  status?: number;
  /** True when retrying with the same input could succeed (5xx, 429, network). */
  is_retriable?: boolean;
  /** Seconds the agent should wait before retry (when known, e.g. Retry-After). */
  retry_after_seconds?: number;
  /** Single-line recovery hint (e.g. "Run: revolutcli auth"). */
  recovery_hint?: string;
  /** Structured suggestions — for "did you mean?" surfaces (e.g. valid slugs). */
  suggestions?: string[];
  /**
   * Numeric error code from Revolut's response body (e.g. 9002 for IP whitelist).
   * Surfaced verbatim so agents can route on Revolut's vendor codes too.
   */
  revolut_error_code?: number;
  /** Underlying cause, if any. Not surfaced to agents. */
  cause?: unknown;
}

/**
 * An error that carries enough metadata for an agent to decide its next move.
 *
 * Throw this from any layer (api.ts, commands.ts, auth.ts) and let
 * `reportError()` in index.ts serialize it.
 */
export class RevolutError extends Error {
  readonly code: RevolutErrorCode;
  readonly status?: number;
  readonly is_retriable: boolean;
  readonly retry_after_seconds?: number;
  readonly recovery_hint?: string;
  readonly suggestions?: string[];
  readonly revolut_error_code?: number;

  constructor(message: string, opts: RevolutErrorOptions) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "RevolutError";
    this.code = opts.code;
    this.status = opts.status;
    this.is_retriable = opts.is_retriable ?? false;
    this.retry_after_seconds = opts.retry_after_seconds;
    this.recovery_hint = opts.recovery_hint;
    this.suggestions = opts.suggestions;
    this.revolut_error_code = opts.revolut_error_code;
  }
}

/** Map an error code to its sysexits-aligned exit code. */
export function exitCodeFor(code: RevolutErrorCode): number {
  switch (code) {
    case "USAGE":
      return EXIT.USAGE;
    case "VALIDATION":
      return EXIT.DATAERR;
    case "AUTH_MISSING":
    case "AUTH_EXPIRED":
    case "AUTH_REFUSED":
    case "IP_NOT_WHITELISTED":
    case "INSUFFICIENT_SCOPE":
      return EXIT.NOPERM;
    case "ACCOUNT_NOT_FOUND":
      return EXIT.NOTFOUND;
    case "RATE_LIMITED":
    case "API_ERROR":
    case "NETWORK_ERROR":
      return EXIT.UNAVAILABLE;
    case "INTERNAL":
      return EXIT.GENERIC;
  }
}

/**
 * Serialize a thrown value to the structured error envelope and exit.
 *
 * Plain `Error` (or anything else) becomes an INTERNAL error — agents see a
 * consistent shape regardless of which layer threw.
 */
export function reportError(err: unknown, command?: string): never {
  const re = err instanceof RevolutError ? err : toInternal(err);

  const envelope: Record<string, unknown> = {
    ok: false,
    error: re.message,
    code: re.code,
    is_retriable: re.is_retriable,
  };
  if (command) envelope.command = command;
  if (re.status !== undefined) envelope.status = re.status;
  if (re.revolut_error_code !== undefined) {
    envelope.revolut_error_code = re.revolut_error_code;
  }
  if (re.retry_after_seconds !== undefined) {
    envelope.retry_after_seconds = re.retry_after_seconds;
  }
  if (re.recovery_hint) envelope.recovery_hint = re.recovery_hint;
  if (re.suggestions && re.suggestions.length > 0) {
    envelope.suggestions = re.suggestions;
  }

  process.stdout.write(`${stringify(envelope)}\n`);
  process.exit(exitCodeFor(re.code));
}

/**
 * JSON encoder that picks formatting based on whether stdout is a TTY:
 * pretty (2-space indent) when a human is reading, compact (single line)
 * when piped — agents and `jq` both prefer compact, humans prefer indented.
 */
export function stringify(value: unknown): string {
  return process.stdout.isTTY
    ? JSON.stringify(value, null, 2)
    : JSON.stringify(value);
}

/**
 * Emit a success envelope and exit cleanly.
 *
 * Mirrors @howells/cli's `success()` shape but routes through `stringify()`
 * so output is compact when piped.
 */
export function reportSuccess(
  data: unknown,
  command?: string,
  extra?: Record<string, unknown>,
): never {
  const envelope: Record<string, unknown> = { ok: true, data };
  if (command) envelope.command = command;
  if (extra) Object.assign(envelope, extra);
  process.stdout.write(`${stringify(envelope)}\n`);
  process.exit(EXIT.OK);
}

/**
 * Emit a list of items as newline-delimited JSON (NDJSON) and exit.
 *
 * Each item becomes its own compact JSON line. Used by `transactions
 * --ndjson` so streaming consumers can process row-by-row without buffering
 * the whole envelope.
 *
 * The closing line is `{"ok":true,"meta":...}` so consumers can still detect
 * truncation (meta.has_more) without a separate request.
 */
export function reportNdjson(
  items: unknown[],
  meta?: Record<string, unknown>,
): never {
  for (const item of items) {
    process.stdout.write(`${JSON.stringify(item)}\n`);
  }
  if (meta) {
    process.stdout.write(`${JSON.stringify({ ok: true, meta })}\n`);
  }
  process.exit(EXIT.OK);
}

function toInternal(err: unknown): RevolutError {
  const message = err instanceof Error ? err.message : String(err);
  return new RevolutError(message, {
    code: "INTERNAL",
    is_retriable: false,
    cause: err,
  });
}
