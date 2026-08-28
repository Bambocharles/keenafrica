import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  generateTotpCode,
  generateTotpSecretBase32,
  hashRecoveryCode,
  totpAuthUri,
  verifyTotpCode,
} from "@/lib/mfa-crypto";

const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

describe("base32Encode/base32Decode", () => {
  it("round-trips arbitrary bytes", () => {
    const original = Buffer.from([0, 1, 2, 3, 255, 254, 128, 17, 42]);
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it("round-trips a generated TOTP secret", () => {
    const secret = generateTotpSecretBase32();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe("TOTP generation/verification (RFC 6238)", () => {
  it("verifies a code generated for the current time", () => {
    const secret = generateTotpSecretBase32();
    const code = generateTotpCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects a code from a different secret", () => {
    const secretA = generateTotpSecretBase32();
    const secretB = generateTotpSecretBase32();
    const codeForA = generateTotpCode(secretA);
    expect(verifyTotpCode(secretB, codeForA)).toBe(false);
  });

  it("rejects a malformed code", () => {
    const secret = generateTotpSecretBase32();
    expect(verifyTotpCode(secret, "abc")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
    expect(verifyTotpCode(secret, "")).toBe(false);
  });

  it("accepts a code from one step in the past or future (clock drift tolerance)", () => {
    const secret = generateTotpSecretBase32();
    const now = Date.now();
    const past = generateTotpCode(secret, now - 30_000);
    const future = generateTotpCode(secret, now + 30_000);
    expect(verifyTotpCode(secret, past, { timeMs: now })).toBe(true);
    expect(verifyTotpCode(secret, future, { timeMs: now })).toBe(true);
  });

  it("rejects a code from two steps away", () => {
    const secret = generateTotpSecretBase32();
    const now = Date.now();
    const tooOld = generateTotpCode(secret, now - 90_000);
    expect(verifyTotpCode(secret, tooOld, { timeMs: now })).toBe(false);
  });

  it("builds a well-formed otpauth:// URI", () => {
    const uri = totpAuthUri({ secretBase32: "JBSWY3DPEHPK3PXP", accountLabel: "a@b.com", issuer: "Keen Africa" });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Keen");
  });
});

describe("TOTP secret encryption at rest", () => {
  it("round-trips through encrypt/decrypt", () => {
    process.env.AUTH_SECRET = "test-secret-value";
    const secret = generateTotpSecretBase32();
    const ciphertext = encryptTotpSecret(secret);
    expect(ciphertext).not.toContain(secret);
    expect(decryptTotpSecret(ciphertext)).toBe(secret);
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  });

  it("fails to decrypt with a different AUTH_SECRET (proves the key material actually matters)", () => {
    process.env.AUTH_SECRET = "key-one";
    const ciphertext = encryptTotpSecret(generateTotpSecretBase32());
    process.env.AUTH_SECRET = "key-two";
    expect(() => decryptTotpSecret(ciphertext)).toThrow();
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  });
});

describe("recovery codes", () => {
  it("generates codes matching the expected shape", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("hashing is deterministic and case/whitespace-insensitive", () => {
    const code = generateRecoveryCode();
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(`  ${code}  `)).toBe(hashRecoveryCode(code));
  });

  it("different codes hash differently", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b));
  });
});
