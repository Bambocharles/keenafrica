import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { withRls } from "@/lib/rls";

// basePath is "/auth", not the default "/api/auth" — a Cloudflare Worker
// intercepts keenafrica.com/api/* (and *.keenafrica.com/api/*) at the edge
// for the contact-form/feedback endpoints and hard-404s everything else
// under /api/*. Auth.js's default route would be silently swallowed by it
// on every hostname. See terraform/worker.tf. Keep every portal route off
// /api/* for the same reason.
export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/auth",
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await withRls({ authLookup: true }, (tx) =>
          tx.user.findUnique({ where: { email } })
        );
        if (!user) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
        };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.isSuperAdmin = (user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.isSuperAdmin = Boolean(token.isSuperAdmin);
      }
      return session;
    },
  },
});
