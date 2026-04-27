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

  constructor(message: string, opts: RevolutErrorOptions) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "RevolutError";
    this.code = opts.code;
    this.status = opts.status;
    this.is_retriable = opts.is_retriable ?? false;
    this.retry_after_seconds = opts.retry_after_seconds;
    this.recovery_hint = opts.recovery_hint;
    this.suggestions = opts.suggestions;
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
  if (re.retry_after_seconds !== undefined) {
    envelope.retry_after_seconds = re.retry_after_seconds;
  }
  if (re.recovery_hint) envelope.recovery_hint = re.recovery_hint;
  if (re.suggestions && re.suggestions.length > 0) {
    envelope.suggestions = re.suggestions;
  }

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(exitCodeFor(re.code));
}

function toInternal(err: unknown): RevolutError {
  const message = err instanceof Error ? err.message : String(err);
  return new RevolutError(message, {
    code: "INTERNAL",
    is_retriable: false,
    cause: err,
  });
}
