import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { withRls } from "@/lib/rls";
import { createSession, resolveSessionAuthz } from "@/lib/sessions";
import { recordAuditEvent } from "@/lib/audit";
import { isLoginRateLimited } from "@/lib/rate-limit";

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

        if (!user) return null;

        const valid = await compare(password, user.passwordHash);
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
        if (user.status === "suspended") {
          await recordAuditEvent({
            actorId: user.id,
            action: "login.denied_suspended",
            entityType: "User",
            entityId: user.id,
            ipAddress,
          });
          return null;
        }

        const session = await createSession({
          userId: user.id,
          userAgent: request.headers.get("user-agent"),
          ipAddress,
        });

        await recordAuditEvent({
          actorId: user.id,
          action: "login.succeeded",
          entityType: "User",
          entityId: user.id,
          metadata: { sessionId: session.id },
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
  ],
  callbacks: {
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
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.isSuperAdmin = Boolean(token.isSuperAdmin);
        session.user.roles = token.roles ?? [];
        session.user.permissions = token.permissions ?? [];
        session.user.sessionId = token.sessionId as string;
      }
      return session;
    },
  },
});
