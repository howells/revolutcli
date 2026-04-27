/**
 * Revolut-specific error helpers built on top of @howells/cli's CliError.
 *
 * Most of the machinery (CliError class, EXIT constants, exitCodeFor,
 * reportError, reportSuccess, reportNdjson, stringify) lives in
 * `@howells/cli` so wisecli, starlingcli, etc. share it. This module adds
 * the Revolut-specific vendor codes and a tiny re-export shim so existing
 * call sites that say `RevolutError` keep working.
 */

import { CliError, type CliErrorOptions, type ErrorCode } from "@howells/cli";

export {
  asCliError,
  EXIT,
  errorEnvelope,
  exitCodeFor,
  reportError,
  reportNdjson,
  reportSuccess,
  stringify,
} from "@howells/cli";

/**
 * Revolut-specific error codes. The standard set is in `@howells/cli`'s
 * `StandardErrorCode`; here we add only the codes Revolut introduces.
 */
export type RevolutVendorCode =
  | "IP_NOT_WHITELISTED" // 403 with vendor code 9002
  | "ACCOUNT_NOT_FOUND"; // slug didn't resolve to a sub-account

/** Union of standard and Revolut vendor codes. */
export type RevolutErrorCode = ErrorCode | RevolutVendorCode;

/**
 * Backward-compatible alias for `CliError`. Existing code that says
 * `new RevolutError(...)` and `instanceof RevolutError` keeps working.
 */
export class RevolutError extends CliError {
  constructor(
    message: string,
    opts: CliErrorOptions & { revolut_error_code?: number },
  ) {
    // Fold revolut_error_code into the generic `extra` bag so the envelope
    // surfaces it under a vendor-prefixed key.
    const { revolut_error_code, extra, ...rest } = opts;
    const merged =
      revolut_error_code !== undefined
        ? { ...(extra ?? {}), revolut_error_code }
        : extra;
    super(message, { ...rest, extra: merged });
    this.name = "RevolutError";
  }
}

export type RevolutErrorOptions = CliErrorOptions & {
  revolut_error_code?: number;
};
