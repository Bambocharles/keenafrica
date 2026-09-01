import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";
import { headers } from "next/headers";
import { compare } from "bcryptjs";
import { withRls } from "@/lib/rls";
import { createSession, resolveSessionAuthz, revokeSessionAsSystem } from "@/lib/sessions";
import { recordAuditEvent } from "@/lib/audit";
import { isLoginRateLimited } from "@/lib/rate-limit";
import { resolveGoogleSignIn, resolveLinkedInSignIn, type GoogleSignInRejectionReason } from "@/lib/oauth-identity";
import type { RegisterableRole } from "@/lib/registration";
import { shouldRequireLoginMfa } from "@/lib/mfa";

// Mirrors registration.ts's REGISTERABLE_ROLES/"the subdomain IS the
// platform-role choice" convention (Session 18) for the one case Google
// sign-in can also create a brand-new account: admin.<root>/sponsor.<root>
// have no public signup path at all (Session 18's explicit "Must NOT: no
// public path to an ADMIN/SPONSOR_* account"), so they resolve to undefined
// here and oauth-identity.ts's resolveGoogleSignIn() rejects a first-time
// Google sign-in on those subdomains rather than creating an account.
async function subdomainSignupRole(): Promise<RegisterableRole | undefined> {
  try {
    const h = await headers();
    const host = (h.get("host") ?? "").split(":")[0].toLowerCase();
    const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
    if (host === `teacher.${rootDomain}`) return "TEACHER";
    if (host === `student.${rootDomain}`) return "STUDENT";
    // Session 34 (Keen Africans) — same convention, third self-registerable
    // subdomain.
    if (host === `keenafricans.${rootDomain}`) return "KEEN_AFRICAN";
    return undefined;
  } catch {
    // Fails safe: no role resolved means resolveGoogleSignIn() will never
    // create a new account, only ever sign in/link an existing one.
    return undefined;
  }
}

const GOOGLE_REJECTION_ERROR_CODES: Record<GoogleSignInRejectionReason, string> = {
  no_email: "google_no_email",
  email_exists_unlinked: "google_email_exists",
  no_self_service_signup: "google_no_account",
  conflicting_link: "google_conflicting_link",
  account_suspended: "google_account_suspended",
};

// Session 40 (Keen Africans — LinkedIn Verification). Same shape as
// GOOGLE_REJECTION_ERROR_CODES above, reusing the identical rejection-reason
// type (see oauth-identity.ts's resolveLinkedInSignIn() docstring for why
// LinkedIn only ever produces a subset of these in practice —
// no_self_service_signup covers every "not an active connect flow" case).
const LINKEDIN_REJECTION_ERROR_CODES: Record<GoogleSignInRejectionReason, string> = {
  no_email: "linkedin_no_email",
  email_exists_unlinked: "linkedin_email_exists",
  no_self_service_signup: "linkedin_no_account",
  conflicting_link: "linkedin_conflicting_link",
  account_suspended: "linkedin_account_suspended",
};

// basePath is "/auth", not the default "/api/auth" — a Cloudflare Worker
// intercepts keenafrica.com/api/* (and *.keenafrica.com/api/*) at the edge
// for the contact-form/feedback endpoints and hard-404s everything else
// under /api/*. Auth.js's default route would be silently swallowed by it
// on every hostname. See terraform/worker.tf. Keep every portal route off
// /api/* for the same reason.
export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/auth",
  // Every project subdomain is a different Host header (that's the whole
  // point of the wildcard routing) — Auth.js's default same-origin Host
  // check would reject all of them. Safe here because nothing about auth
  // decisions depends on the Host header itself; tenant identity comes from
  // the URL path after middleware's rewrite, not from trusting the host.
  trustHost: true,
  session: { strategy: "jwt" },
  // Relative to the admin subdomain - middleware prepends "/admin" on the
  // fresh request any Auth.js-triggered redirect here causes.
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const ipAddress = request.headers.get("x-forwarded-for");

        const user = await withRls({ authLookup: true }, (tx) =>
          tx.user.findUnique({ where: { email } })
        );

        // Checked before the password compare (skip the bcrypt cost on a
        // blocked attempt) and before any user-specific branching below —
        // an unknown email still counts against the per-IP limit. See
        // src/lib/rate-limit.ts for the thresholds/reasoning.
        if (await isLoginRateLimited({ userId: user?.id, ipAddress })) {
          await recordAuditEvent({
            actorId: user?.id ?? null,
            action: "login.rate_limited",
            entityType: "User",
            entityId: user?.id ?? null,
            ipAddress,
          });
          return null;
        }

        if (!user) {
          // No actorId to attach (there's no account) — still recorded so
          // the per-IP limit above actually accumulates for exactly the
          // case it's documented to cover (email-enumeration/spraying
          // against unknown addresses). Before this, an unknown-email
          // attempt was silently un-audited and could never contribute to
          // any rate limit, no matter how many were sent from one IP.
          await recordAuditEvent({
            actorId: null,
            action: "login.failed",
            entityType: "User",
            entityId: null,
            ipAddress,
          });
          return null;
        }

        // Federated Auth (Session 19) — a Google-only account has no
        // passwordHash at all (see schema.prisma's comment on
        // User.passwordHash). Treated the same as a wrong password: denied
        // without distinguishing it from any other invalid-credentials
        // case, so a caller can't use this to detect "this email is a
        // Google-only account."
        const valid = user.passwordHash ? await compare(password, user.passwordHash) : false;
        if (!valid) {
          await recordAuditEvent({
            actorId: user.id,
            action: "login.failed",
            entityType: "User",
            entityId: user.id,
            ipAddress,
          });
          return null;
        }

        // Deny login without distinguishing it from a bad password in the
        // response — a suspended account shouldn't be discoverable by an
        // unauthenticated caller any more than a nonexistent one is.
        // 'deleted' (Session 37) is treated the same way here — belt-and-
        // suspenders only: anonymizeOwnAccount() already clears
        // passwordHash, so `valid` above is already false for a deleted
        // account regardless of this check.
        if (user.status === "suspended" || user.status === "deleted") {
          await recordAuditEvent({
            actorId: user.id,
            action: "login.denied_suspended",
            entityType: "User",
            entityId: user.id,
            ipAddress,
          });
          return null;
        }

        // MFA & Account Security (Session 20) — decided once, here, from
        // src/lib/mfa.ts's shouldRequireLoginMfa() (already-enrolled TOTP,
        // or the account's role is covered by the MFA policy). Session 02's
        // login.succeeded below still fires immediately: the PRIMARY factor
        // did succeed. Whether this session can do anything beyond the MFA
        // challenge itself is enforced downstream, server-side, by
        // resolveSessionAuthz() zeroing roles/permissions while mfaRequired
        // is true and mfaVerifiedAt isn't set yet — never by this audit
        // event or by which page the client happens to be redirected to.
        const mfaRequired = await shouldRequireLoginMfa(user.id);

        const session = await createSession({
          userId: user.id,
          userAgent: request.headers.get("user-agent"),
          ipAddress,
          mfaRequired,
        });

        await recordAuditEvent({
          actorId: user.id,
          action: "login.succeeded",
          entityType: "User",
          entityId: user.id,
          metadata: { sessionId: session.id, mfaRequired },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
          sessionId: session.id,
        };
      },
    }),
    // Session 19 (Federated Auth). Additive to Credentials, not a
    // replacement — password login is unchanged. No adapter is configured
    // (see this file's header comment), so all identity linking is
    // hand-rolled in src/lib/oauth-identity.ts's resolveGoogleSignIn(),
    // called from the signIn callback below.
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    // Session 40 (Keen Africans — LinkedIn Verification). Same
    // no-adapter/hand-rolled-linking shape as Google above — identity
    // linking lives in oauth-identity.ts's resolveLinkedInSignIn(), called
    // from the signIn callback below. next-auth's built-in LinkedIn
    // provider is already the current "Sign In with LinkedIn using OpenID
    // Connect" product (type: "oidc", issuer https://www.linkedin.com/oauth
    // — see node_modules/@auth/core/providers/linkedin.js); with no
    // explicit `authorization.params.scope` override it requests the
    // OIDC-provider default "openid profile email" scope, which is exactly
    // the full set LinkedIn's current docs list as supported (openid,
    // profile, email — the legacy r_liteprofile/r_emailaddress scopes are
    // retired). Confirmed against LinkedIn's current Microsoft-Learn-hosted
    // API docs, not assumed — see docs/KEEN_AFRICANS.md's "Verification"
    // section. This grants name/email/photo ONLY; there is no scope or
    // endpoint exposing LinkedIn's own identity-verification status to a
    // third party, which is the entire reason this feature is a human
    // review workflow (src/lib/verification.ts) rather than an automatic
    // badge.
    LinkedIn({
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // Only the Google branch does anything here — Credentials already
    // resolved everything (including the rate limit/suspension checks) in
    // authorize() above, before this callback ever runs, so it's a no-op
    // pass-through for that provider.
    //
    // Mutating `user.id`/`user.sessionId` below (rather than returning
    // something) is deliberate, not a stray side effect: without a database
    // adapter, @auth/core's handleLoginOrRegister() short-circuits to
    // `return { user: <the OAuth provider's raw profile>, account }`
    // (node_modules/@auth/core/lib/actions/callback/handle-login.js) and
    // that exact object — the same one this callback receives as `user` —
    // is what the jwt callback below is then called with. Rewriting its
    // `id` from Google's subject id to our internal User.id here is the
    // only hook available to make `token.sub` end up correct; there is no
    // adapter-based alternative available in this setup.
    signIn: async ({ user, account }) => {
      if (account?.provider === "linkedin") {
        if (!account.providerAccountId) return false;

        const h = await headers();
        const ipAddress = h.get("x-forwarded-for");

        const result = await resolveLinkedInSignIn({
          providerAccountId: account.providerAccountId,
          email: user.email,
          name: user.name,
          pictureUrl: user.image,
          ipAddress,
        });

        if (result.outcome === "rejected") {
          // LinkedIn only ever gets here via the /account "Connect
          // LinkedIn" self-service flow (see resolveLinkedInSignIn's own
          // docstring — there is no public "Sign in with LinkedIn" entry
          // point on this platform) — always send errors back to /account,
          // never /login, which an already-authenticated actor would bounce
          // straight off of.
          return `/account?error=${LINKEDIN_REJECTION_ERROR_CODES[result.reason]}`;
        }

        user.id = result.userId;
        (user as { sessionId?: string }).sessionId = result.sessionId;
        return true;
      }

      if (account?.provider !== "google") return true;
      if (!account.providerAccountId) return false;

      const h = await headers();
      const ipAddress = h.get("x-forwarded-for");
      const signupRole = await subdomainSignupRole();

      const result = await resolveGoogleSignIn({
        providerAccountId: account.providerAccountId,
        email: user.email,
        name: user.name,
        ipAddress,
        signupRole,
      });

      if (result.outcome === "rejected") {
        // conflicting_link can only happen mid self-service "connect Google"
        // (see oauth-identity.ts) — send it back to the profile page that
        // started the flow rather than /login, which an already-logged-in
        // actor would just bounce straight off of via its own canAccess*
        // redirect before ever seeing the message.
        if (result.reason === "conflicting_link") {
          return `/profile?error=${GOOGLE_REJECTION_ERROR_CODES[result.reason]}`;
        }
        return `/login?error=${GOOGLE_REJECTION_ERROR_CODES[result.reason]}`;
      }

      user.id = result.userId;
      (user as { sessionId?: string }).sessionId = result.sessionId;
      return true;
    },
    // Runs on every request that calls auth()/getToken(), not just at
    // sign-in — this is what makes a JWT-strategy session revocable. It
    // re-checks the DB-backed Session row (and current roles/permissions/
    // suspension state) every time and returns null to kill the token the
    // moment any of that has changed, rather than trusting whatever was
    // baked in at login.
    jwt: async ({ token, user }) => {
      if (user) {
        token.sessionId = (user as { sessionId?: string }).sessionId;
      }
      if (!token.sessionId || !token.sub) {
        return null;
      }

      const snapshot = await resolveSessionAuthz(token.sessionId, token.sub);
      if (!snapshot) {
        return null;
      }

      token.isSuperAdmin = snapshot.isSuperAdmin;
      token.roles = snapshot.roles;
      token.permissions = snapshot.permissions;
      token.organizationIds = snapshot.organizationIds;
      token.mfaPending = snapshot.mfaPending;
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.isSuperAdmin = Boolean(token.isSuperAdmin);
        session.user.roles = token.roles ?? [];
        session.user.permissions = token.permissions ?? [];
        session.user.organizationIds = token.organizationIds ?? [];
        session.user.sessionId = token.sessionId as string;
        session.user.mfaPending = Boolean(token.mfaPending);
      }
      return session;
    },
  },
  events: {
    // QA (Session 23) — without this, signOut() only cleared the
    // client-side cookie; the DB Session row stayed unrevoked until its
    // natural 30-day expiry, so a copied/stolen session cookie kept working
    // after the legitimate user "logged out" (live-verified: captured a
    // cookie, signed out, replayed the old cookie value — it still granted
    // full access). Revokes only THIS session, never every session for the
    // user — see revokeSessionAsSystem()'s own docstring.
    signOut: async (message) => {
      const token = "token" in message ? message.token : null;
      const sessionId = token?.sessionId as string | undefined;
      const userId = token?.sub as string | undefined;
      if (sessionId && userId) {
        await revokeSessionAsSystem(sessionId, userId);
      }
    },
  },
});
