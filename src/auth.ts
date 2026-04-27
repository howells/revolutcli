/**
 * OAuth + JWT client assertion flow for the Revolut Business API.
 *
 * Revolut requires a one-time authorization where the user visits a consent
 * URL, authorizes the app, and pastes back the redirected `code`. The CLI
 * then exchanges that code (signed with an RSA private key as a JWT
 * client assertion) for an access + refresh token pair, cached on disk.
 *
 * Subsequent runs read the cache and refresh the access token transparently.
 */

import { createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_URL = `https://b2b.revolut.com/api/1.0/auth/token`;
const AUTHORIZE_URL = "https://business.revolut.com/app-confirm";

/** Directory holding cached tokens. 0700 perms enforced on write. */
export const TOKEN_DIR = join(homedir(), ".revolutcli");

/** Path to the cached token file. 0600 perms enforced on write. */
export const TOKEN_PATH = join(TOKEN_DIR, "tokens.json");

export interface CachedTokens {
  access_token: string;
  refresh_token: string;
  /** Unix milliseconds at which the access token becomes invalid. */
  expires_at: number;
}

/** Read REVOLUT_CLIENT_ID from env; throws if missing. */
export function getClientId(): string {
  const id = process.env.REVOLUT_CLIENT_ID?.trim();
  if (!id) {
    throw new Error(
      "REVOLUT_CLIENT_ID env var is required. Get it from https://business.revolut.com/settings/api",
    );
  }
  return id;
}

/** Read the RSA private key referenced by REVOLUT_PRIVATE_KEY_PATH. */
export function getPrivateKey(): string {
  const keyPath = process.env.REVOLUT_PRIVATE_KEY_PATH?.trim();
  if (!keyPath) {
    throw new Error(
      "REVOLUT_PRIVATE_KEY_PATH env var is required (path to your RSA private key PEM).",
    );
  }
  try {
    return readFileSync(keyPath, "utf8");
  } catch {
    throw new Error(
      `Cannot read private key at ${keyPath} — check REVOLUT_PRIVATE_KEY_PATH.`,
    );
  }
}

/**
 * Build a JWT client assertion (RS256) suitable for Revolut's token endpoint.
 * The assertion is short-lived (2 minutes) and signed with the private key
 * paired to the public certificate registered with Revolut.
 *
 * The `iss` claim is fixed to "example.com" because Revolut Business does not
 * require it to match a real domain — only the client_id and signature matter.
 */
export function createJwtAssertion(
  clientId: string,
  privateKey: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: "example.com",
    sub: clientId,
    aud: "https://revolut.com",
    iat: now,
    exp: now + 120,
    jti: randomUUID(),
  };

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const signingInput = `${encode(header)}.${encode(payload)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

/** Build the URL the user visits to grant consent. */
export function buildAuthorizeUrl(
  clientId: string,
  redirectUri = "https://example.com/",
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Load cached tokens from disk. Returns null if the cache is missing. */
export async function loadCachedTokens(): Promise<CachedTokens | null> {
  try {
    const content = await readFile(TOKEN_PATH, "utf8");
    return JSON.parse(content) as CachedTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: CachedTokens): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true });
  await chmod(TOKEN_DIR, 0o700);
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf8");
  await chmod(TOKEN_PATH, 0o600);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Exchange a fresh authorization code for a token pair. */
export async function exchangeCode(code: string): Promise<CachedTokens> {
  const clientId = getClientId();
  const assertion = createJwtAssertion(clientId, getPrivateKey());

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  if (!data.refresh_token) {
    throw new Error("Token exchange returned no refresh_token");
  }
  const tokens: CachedTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  await saveTokens(tokens);
  return tokens;
}

/** Trade an existing refresh token for a new access token. */
export async function refreshAccessToken(
  refreshTok: string,
): Promise<CachedTokens> {
  const clientId = getClientId();
  const assertion = createJwtAssertion(clientId, getPrivateKey());

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTok,
      client_id: clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Token refresh failed (${res.status}): ${text}. Re-run: revolutcli auth`,
    );
  }

  const data = (await res.json()) as TokenResponse;
  const tokens: CachedTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshTok,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  await saveTokens(tokens);
  return tokens;
}

/**
 * Return a valid access token, refreshing if the cached one expires within
 * the next minute. Throws if there is no cache (the user must run `auth`).
 */
export async function getAccessToken(
  now: number = Date.now(),
): Promise<string> {
  const cached = await loadCachedTokens();
  if (!cached) {
    throw new Error("No cached tokens. Run: revolutcli auth");
  }

  if (now < cached.expires_at - 60_000) {
    return cached.access_token;
  }

  const refreshed = await refreshAccessToken(cached.refresh_token);
  return refreshed.access_token;
}

/**
 * Read an authorization code from stdin, prompting the user via stderr.
 * Stdout is reserved for the JSON envelope so the prompt cannot pollute it.
 */
export async function promptForAuthCode(): Promise<string> {
  const consentUrl = buildAuthorizeUrl(getClientId());
  process.stderr.write("\nRevolut OAuth setup\n\n");
  process.stderr.write(`1. Open: ${consentUrl}\n`);
  process.stderr.write("2. Authorize the application.\n");
  process.stderr.write(
    "3. You will be redirected to https://example.com/?code=XXXX\n",
  );
  process.stderr.write("4. Paste the code value below and press Enter.\n\n");
  process.stderr.write("Authorization code: ");

  return new Promise((resolve, reject) => {
    let input = "";
    const onData = (chunk: Buffer | string) => {
      input += chunk.toString();
      const newlineIdx = input.indexOf("\n");
      if (newlineIdx !== -1) {
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("error", onError);
        process.stdin.pause();
        const code = input.slice(0, newlineIdx).trim();
        if (!code) {
          reject(new Error("No authorization code provided"));
        } else {
          resolve(code);
        }
      }
    };
    const onError = (err: Error) => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("error", onError);
      reject(err);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
