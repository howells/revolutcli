/**
 * Subprocess tests for the CLI's argv-based dispatch.
 *
 * The actual command logic is unit-tested elsewhere; these tests exist
 * specifically to verify that `index.ts` routes correctly and that the
 * structured error envelope (code, is_retriable, exit code) reaches stdout
 * for every dispatch path.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXIT } from "./errors.ts";

const ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  json: unknown;
}

function runCli(args: string[], env: Record<string, string> = {}): RunResult {
  const result = spawnSync(
    "node",
    ["--import", "tsx", "--no-warnings", ENTRY, ...args],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  let json: unknown;
  try {
    json = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {
    json = null;
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.status,
    json,
  };
}

describe("CLI dispatch", () => {
  it("schema returns ok envelope with cli=revolutcli, exit 0", () => {
    const r = runCli(["schema"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.json).toMatchObject({
      ok: true,
      command: "schema",
      data: { cli: "revolutcli", readOnly: true },
    });
  });

  it("schema includes structured error envelope and exit-code documentation", () => {
    const r = runCli(["schema"]);
    const data = (r.json as { data: Record<string, unknown> }).data;
    expect(data.envelope).toBeDefined();
    expect(data.exit_codes).toBeDefined();
    expect(data.error_codes).toContain("AUTH_MISSING");
    expect(data.error_codes).toContain("RATE_LIMITED");
  });

  it("schema describes pagination for transactions", () => {
    const r = runCli(["schema"]);
    const cmds = (
      r.json as { data: { commands: Record<string, { pagination?: unknown }> } }
    ).data.commands;
    expect(cmds.transactions?.pagination).toBeDefined();
  });

  it("help returns the usage envelope, exit 0", () => {
    const r = runCli(["help"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.json).toMatchObject({ ok: true, command: "help" });
  });

  it("--help and -h are aliases for help", () => {
    const long = runCli(["--help"]);
    const short = runCli(["-h"]);
    expect(long.code).toBe(EXIT.OK);
    expect(short.code).toBe(EXIT.OK);
    expect(long.json).toMatchObject({ command: "help" });
    expect(short.json).toMatchObject({ command: "help" });
  });

  it("unknown command exits with USAGE code (64) and includes suggestions", () => {
    const r = runCli(["definitely-not-a-command"]);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.json).toMatchObject({
      ok: false,
      code: "USAGE",
      is_retriable: false,
    });
    const suggestions = (r.json as { suggestions: string[] }).suggestions;
    expect(suggestions).toContain("schema");
  });

  it("no command exits with USAGE code (64)", () => {
    const r = runCli([]);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.json).toMatchObject({
      ok: false,
      code: "USAGE",
      is_retriable: false,
    });
  });

  it("transactions without --account exits with USAGE code", () => {
    // No env vars or token cache needed — we hit USAGE before any auth call.
    const r = runCli(["transactions"], {
      REVOLUT_CLIENT_ID: "x",
      REVOLUT_PRIVATE_KEY_PATH: "/dev/null",
    });
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.json).toMatchObject({
      ok: false,
      code: "USAGE",
      command: "transactions",
    });
  });

  it("balance without auth cache exits with NOPERM (77) and AUTH_MISSING code", () => {
    // Point HOME at /tmp/<uuid> so no token cache exists.
    const r = runCli(["balance"], {
      REVOLUT_CLIENT_ID: "x",
      REVOLUT_PRIVATE_KEY_PATH: "/dev/null",
      // Force homedir() to return a directory with no token cache.
      HOME: "/tmp/__revolutcli_test_no_home__",
    });
    expect(r.code).toBe(EXIT.NOPERM);
    expect(r.json).toMatchObject({
      ok: false,
      code: "AUTH_MISSING",
      is_retriable: false,
      command: "balance",
    });
    expect((r.json as { recovery_hint: string }).recovery_hint).toContain(
      "revolutcli auth",
    );
  });
});
