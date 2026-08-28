/**
 * Cookie names shared between src/lib/mfa-actions.ts (a "use server" module
 * — which may only export async Server Actions, not plain constants) and
 * the UI components that read these same short-lived cookies
 * (components/security/{SecurityPanel,MfaChallenge}.tsx). Values only —
 * see mfa-actions.ts for the TTL/httpOnly/etc. cookie options.
 */
export const ENROLL_COOKIE = "mfa_enroll_pending";
export const RECOVERY_COOKIE = "mfa_recovery_codes";
