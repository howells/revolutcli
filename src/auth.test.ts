import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createJwtAssertion,
  getClientId,
  getPrivateKey,
} from "./auth.ts";

const { privateKey: testPrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("getClientId", () => {
  const original = process.env.REVOLUT_CLIENT_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REVOLUT_CLIENT_ID;
    } else {
      process.env.REVOLUT_CLIENT_ID = original;
    }
  });

  it("returns the trimmed value when set", () => {
    process.env.REVOLUT_CLIENT_ID = "  abc-123  ";
    expect(getClientId()).toBe("abc-123");
  });

  it("throws when missing", () => {
    delete process.env.REVOLUT_CLIENT_ID;
    expect(() => getClientId()).toThrow(/REVOLUT_CLIENT_ID/);
  });

  it("throws when empty after trimming", () => {
    process.env.REVOLUT_CLIENT_ID = "   ";
    expect(() => getClientId()).toThrow(/REVOLUT_CLIENT_ID/);
  });
});

describe("getPrivateKey", () => {
  const original = process.env.REVOLUT_PRIVATE_KEY_PATH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REVOLUT_PRIVATE_KEY_PATH;
    } else {
      process.env.REVOLUT_PRIVATE_KEY_PATH = original;
    }
  });

  it("throws when env var unset", () => {
    delete process.env.REVOLUT_PRIVATE_KEY_PATH;
    expect(() => getPrivateKey()).toThrow(/REVOLUT_PRIVATE_KEY_PATH/);
  });

  it("throws when file is missing", () => {
    process.env.REVOLUT_PRIVATE_KEY_PATH = "/tmp/revolutcli-no-such-key.pem";
    expect(() => getPrivateKey()).toThrow(/Cannot read private key/);
  });
});

describe("createJwtAssertion", () => {
  it("produces a three-part base64url JWT", () => {
    const jwt = createJwtAssertion("client-id", testPrivateKey, 1700000000);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("encodes the expected header + payload claims", () => {
    const jwt = createJwtAssertion("client-id", testPrivateKey, 1700000000);
    const [headerEnc, payloadEnc] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(headerEnc as string, "base64url").toString("utf8"),
    );
    const payload = JSON.parse(
      Buffer.from(payloadEnc as string, "base64url").toString("utf8"),
    );
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.sub).toBe("client-id");
    expect(payload.iss).toBe("example.com");
    expect(payload.aud).toBe("https://revolut.com");
    expect(payload.iat).toBe(1700000000);
    expect(payload.exp).toBe(1700000120);
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti).toHaveLength(36);
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes the client_id and the default redirect_uri", () => {
    const url = buildAuthorizeUrl("abc");
    expect(url).toContain("https://business.revolut.com/app-confirm");
    expect(url).toContain("client_id=abc");
    expect(url).toContain("response_type=code");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2F");
  });

  it("respects a custom redirect_uri", () => {
    const url = buildAuthorizeUrl("abc", "https://other.test/cb");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fother.test%2Fcb");
  });
});
