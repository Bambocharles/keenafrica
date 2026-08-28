import crypto from "node:crypto";

/**
 * TOTP (RFC 6238, on top of HOTP/RFC 4226) and secret-at-rest encryption for
 * MFA & Account Security (Session 20). Hand-rolled on Node's built-in
 * `crypto` rather than an added dependency — same "plain fetch() over an
 * SDK" bias this repo already applied to Session 19's Resend integration;
 * this is the security-critical half of MFA, so fewer supply-chain
 * dependencies here specifically is a deliberate choice. `qrcode` (added
 * this session) is used only for enrollment display, never for anything
 * that verifies a code.
 *
 * Pure functions, no DB/RLS — unit-tested directly in mfa-crypto.test.ts.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20; // 160 bits — RFC 4226's recommended HMAC-SHA1 key size.

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh random secret, base32-encoded for display/QR — never persisted in this form (see mfa.ts). */
export function generateTotpSecretBase32(): string {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(truncated % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function totpCounterFor(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

/** For tests/tooling that need to generate a valid code for a known secret. */
export function generateTotpCode(secretBase32: string, timeMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpCounterFor(timeMs));
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Accepts a ±1 step window (90s total) to absorb clock drift between the
 * server and the authenticator app — the standard RFC 6238 tolerance.
 */
export function verifyTotpCode(secretBase32: string, code: string, opts: { timeMs?: number } = {}): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;

  const secret = base32Decode(secretBase32);
  const timeMs = opts.timeMs ?? Date.now();
  const counter = totpCounterFor(timeMs);

  for (let drift = -1; drift <= 1; drift++) {
    if (timingSafeEqualStrings(hotp(secret, counter + drift), normalized)) {
      return true;
    }
  }
  return false;
}

export function totpAuthUri(opts: { secretBase32: string; accountLabel: string; issuer: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountLabel}`);
  const params = new URLSearchParams({
    secret: opts.secretBase32,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Secret-at-rest encryption --------------------------------------------
//
// A TOTP secret can't be hashed like a password (verification needs the
// original value back), so it's encrypted instead — AES-256-GCM, keyed by a
// SHA-256 derivation of AUTH_SECRET (the same env var oauth-link-intent.ts
// already trusts for HMAC signing), rather than provisioning a second
// secret just for this. isSuperAdmin's RLS bypass is unchanged
// platform-wide (docs/IDENTITY_SECURITY.md) — this encryption is the real
// backstop against a raw `totp_credentials` read (via that bypass, a DB
// dump, or a misconfigured role) ever yielding a usable seed.

function deriveEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return crypto.createHash("sha256").update(`mfa-totp-secret:${secret}`).digest();
}

export function encryptTotpSecret(secretBase32: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptTotpSecret(ciphertextBase64: string): string {
  const key = deriveEncryptionKey();
  const raw = Buffer.from(ciphertextBase64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// --- Recovery codes --------------------------------------------------------

const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids transcription ambiguity.

/** A human-typeable code like "XXXX-XXXX-XXXX" — not base32/TOTP-related, just a distinct random-token shape. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let group = "";
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      group += RECOVERY_CODE_ALPHABET[bytes[i] % RECOVERY_CODE_ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export function hashRecoveryCode(rawCode: string): string {
  return crypto.createHash("sha256").update(rawCode.trim().toUpperCase()).digest("hex");
}
