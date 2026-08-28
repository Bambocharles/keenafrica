import crypto from "node:crypto";

/**
 * Session 19 (Federated Auth) — carries "an already-authenticated user
 * asked to connect Google to their own account" across the Google OAuth
 * redirect round trip, into src/lib/oauth-identity.ts's
 * resolveGoogleSignIn(). That function has no other way to know who is
 * asking: Auth.js's signIn callback for an OAuth provider gets no request/
 * session of its own to inspect (see its call site in src/lib/auth.ts), and
 * calling this repo's own auth() from inside oauth-identity.ts would be a
 * circular import back into auth.ts.
 *
 * This is a short-lived, single-use, HttpOnly, HMAC-signed cookie — NOT a
 * bare user id, since an HttpOnly cookie only stops client-side *reads*, not
 * a malicious page setting one directly. Signing with AUTH_SECRET makes the
 * value unforgeable: nothing but this server can mint a valid one, and it
 * can only ever have been minted by an authenticated actor linking their
 * OWN id (see the Server Action callers — always session.user.id, never a
 * parameter an attacker could swap). Modeled on password-reset.ts's
 * hashed-token-plus-expiry shape, adapted to a signed cookie since this
 * carries a plain (non-secret) user id rather than a bearer credential.
 */

export const OAUTH_LINK_INTENT_COOKIE = "oauth_link_intent";
const TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured");
  return s;
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Value to set on OAUTH_LINK_INTENT_COOKIE — mint immediately before redirecting into signIn("google"). */
export function createLinkIntentValue(userId: string): string {
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${signPayload(payload)}`;
}

/** Returns the linking user's id iff the value is well-formed, correctly signed, and unexpired. */
export function verifyLinkIntentValue(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !Number.isFinite(expiresAt)) return null;

  const expected = signPayload(`${userId}.${expiresAtRaw}`);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }
  if (Date.now() > expiresAt) return null;
  return userId;
}
