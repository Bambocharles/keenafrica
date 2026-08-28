import { cookies } from "next/headers";
import { withRls } from "@/lib/rls";
import { createSession } from "@/lib/sessions";
import { recordAuditEvent } from "@/lib/audit";
import { registerUserViaProvider, type RegisterableRole } from "@/lib/registration";
import { OAUTH_LINK_INTENT_COOKIE, verifyLinkIntentValue } from "@/lib/oauth-link-intent";
import { shouldRequireLoginMfa } from "@/lib/mfa";

/**
 * Session 19 (Federated Auth) — the entire Google account-linking rule in
 * one place, called from src/lib/auth.ts's signIn callback (the one spot in
 * this codebase that owns "who does this OAuth sign-in resolve to").
 *
 * THE RULE (documented per this session's explicit "Must NOT: silently
 * merge two accounts on email match without a deliberate, documented
 * rule"):
 *
 * 1. A UserIdentity row already exists for this (provider, providerAccountId)
 *    -> sign in as that linked User. Always. (Or reject, if a conflicting
 *    link-intent cookie says a DIFFERENT user is mid-"connect Google.")
 * 2. No identity row, but the browser carries a valid link-intent cookie
 *    (see oauth-link-intent.ts) -> this is an ALREADY-AUTHENTICATED user
 *    self-service connecting Google to their own account. Both factors are
 *    proven at this point (password login earlier + completing this OAuth
 *    handshake now), so linking here is safe and deliberate, not a silent
 *    merge.
 * 3. No identity row, no link-intent cookie, but a User already exists with
 *    this email (a password account that has never connected Google) ->
 *    REJECT. This is exactly the case the "Must NOT" forbids auto-merging.
 *    The user is told to log in with their password and connect Google from
 *    their profile (case 2) instead.
 * 4. No identity row, no link-intent cookie, no existing User with this
 *    email, and the caller supplied a signupRole (only teacher/student
 *    subdomains do — see auth.ts's subdomainSignupRole(), mirroring
 *    registration.ts's REGISTERABLE_ROLES restriction on self-registration)
 *    -> brand-new Google-only account, same shape as self-registration.
 * 5. Anything else (no signupRole resolved, e.g. the admin/sponsor
 *    subdomains, which have no public signup path at all) -> REJECT.
 */

export interface GoogleSignInInput {
  providerAccountId: string;
  email: string | null | undefined;
  name: string | null | undefined;
  ipAddress?: string | null;
  /** Only set when the sign-in happened on a subdomain that allows self-service signup (teacher/student). */
  signupRole?: RegisterableRole;
}

export type GoogleSignInRejectionReason =
  | "no_email"
  | "email_exists_unlinked"
  | "no_self_service_signup"
  | "conflicting_link"
  | "account_suspended";

export type GoogleSignInResult =
  | { outcome: "ok"; userId: string; email: string; name: string; sessionId: string }
  | { outcome: "rejected"; reason: GoogleSignInRejectionReason };

async function auditRejection(reason: GoogleSignInRejectionReason, userId?: string | null): Promise<void> {
  await recordAuditEvent({
    actorId: userId ?? null,
    action: "login.failed",
    entityType: "User",
    entityId: userId ?? null,
    metadata: { provider: "google", reason },
  });
}

async function signInAsExisting(
  user: { id: string; email: string; name: string; status: string },
  ipAddress?: string | null
): Promise<GoogleSignInResult> {
  if (user.status === "suspended") {
    await auditRejection("account_suspended", user.id);
    return { outcome: "rejected", reason: "account_suspended" };
  }

  const mfaRequired = await shouldRequireLoginMfa(user.id);
  const session = await createSession({ userId: user.id, ipAddress, mfaRequired });
  await recordAuditEvent({
    actorId: user.id,
    action: "login.succeeded",
    entityType: "User",
    entityId: user.id,
    metadata: { sessionId: session.id, provider: "google", mfaRequired },
  });
  return { outcome: "ok", userId: user.id, email: user.email, name: user.name, sessionId: session.id };
}

/** Consumes (deletes) the link-intent cookie exactly once per call — single-use regardless of outcome. */
async function consumeLinkIntent(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(OAUTH_LINK_INTENT_COOKIE)?.value;
  if (raw === undefined) return null;
  store.delete(OAUTH_LINK_INTENT_COOKIE);
  return verifyLinkIntentValue(raw);
}

export async function resolveGoogleSignIn(input: GoogleSignInInput): Promise<GoogleSignInResult> {
  const email = input.email?.trim().toLowerCase();
  if (!email) {
    await auditRejection("no_email");
    return { outcome: "rejected", reason: "no_email" };
  }

  const existingIdentity = await withRls({ oauthLookup: true }, (tx) =>
    tx.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: input.providerAccountId } },
      select: { userId: true },
    })
  );

  const linkIntentUserId = await consumeLinkIntent();

  if (existingIdentity) {
    if (linkIntentUserId && linkIntentUserId !== existingIdentity.userId) {
      // Someone is authenticated as one account but this Google account is
      // already linked to a DIFFERENT one — never silently re-point a link.
      await auditRejection("conflicting_link", linkIntentUserId);
      return { outcome: "rejected", reason: "conflicting_link" };
    }

    const user = await withRls({ userId: existingIdentity.userId }, (tx) =>
      tx.user.findUnique({
        where: { id: existingIdentity.userId },
        select: { id: true, email: true, name: true, status: true },
      })
    );
    if (!user) {
      await auditRejection("account_suspended", existingIdentity.userId);
      return { outcome: "rejected", reason: "account_suspended" };
    }
    return signInAsExisting(user, input.ipAddress);
  }

  if (linkIntentUserId) {
    // Self-service "connect Google" — the linking user already proved
    // control of their account (they were authenticated to mint the
    // cookie) and has now proved control of this Google account too.
    const user = await withRls({ userId: linkIntentUserId }, (tx) =>
      tx.user.findUnique({
        where: { id: linkIntentUserId },
        select: { id: true, email: true, name: true, status: true },
      })
    );
    if (!user) {
      await auditRejection("account_suspended", linkIntentUserId);
      return { outcome: "rejected", reason: "account_suspended" };
    }

    await withRls({ userId: linkIntentUserId }, (tx) =>
      tx.userIdentity.create({
        data: { userId: linkIntentUserId, provider: "google", providerAccountId: input.providerAccountId },
      })
    );
    await recordAuditEvent({
      actorId: user.id,
      action: "oauth_identity.linked",
      entityType: "User",
      entityId: user.id,
      metadata: { provider: "google" },
    });
    return signInAsExisting(user, input.ipAddress);
  }

  // No link-intent, no existing identity — a fresh, unauthenticated
  // Google sign-in. Never silently merge onto an existing password account
  // that has never connected Google (this session's explicit "Must NOT").
  const existingByEmail = await withRls({ authLookup: true }, (tx) =>
    tx.user.findUnique({ where: { email }, select: { id: true } })
  );
  if (existingByEmail) {
    await auditRejection("email_exists_unlinked", existingByEmail.id);
    return { outcome: "rejected", reason: "email_exists_unlinked" };
  }

  if (!input.signupRole) {
    await auditRejection("no_self_service_signup");
    return { outcome: "rejected", reason: "no_self_service_signup" };
  }

  const registered = await registerUserViaProvider({
    email,
    name: input.name?.trim() || email,
    role: input.signupRole,
  });
  if (!registered.ok) {
    // email_taken here means a genuine race against a concurrent
    // registration between the lookup above and this insert — same
    // rejection an unlinked-existing-account attempt gets.
    await auditRejection("email_exists_unlinked");
    return { outcome: "rejected", reason: "email_exists_unlinked" };
  }

  await withRls({ oauthLookup: true }, (tx) =>
    tx.userIdentity.create({
      data: { userId: registered.userId, provider: "google", providerAccountId: input.providerAccountId },
    })
  );

  // A brand-new self-registered account can never hold SUPER_ADMIN (see
  // registration.ts's REGISTERABLE_ROLES) and has no TOTP enrolled yet, so
  // this is always false in practice — computed the same way regardless,
  // rather than assuming, so this stays correct if that ever changes.
  const mfaRequired = await shouldRequireLoginMfa(registered.userId);
  const session = await createSession({ userId: registered.userId, ipAddress: input.ipAddress, mfaRequired });
  await recordAuditEvent({
    actorId: registered.userId,
    action: "login.succeeded",
    entityType: "User",
    entityId: registered.userId,
    metadata: { sessionId: session.id, provider: "google", newAccount: true },
  });

  return { outcome: "ok", userId: registered.userId, email: registered.email, name: registered.name, sessionId: session.id };
}

/** Self-scoped read for a profile page's "Connected accounts" section — no permission required, same "always your own id" shape as getOwnProfile(). */
export async function listOwnLinkedProviders(userId: string): Promise<string[]> {
  const rows = await withRls({ userId }, (tx) =>
    tx.userIdentity.findMany({ where: { userId }, select: { provider: true } })
  );
  return rows.map((r) => r.provider);
}
