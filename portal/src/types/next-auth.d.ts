import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isSuperAdmin: boolean;
      roles: string[];
      permissions: string[];
      /** The DB-backed sessions.id this login corresponds to — see src/lib/sessions.ts. */
      sessionId: string;
    } & DefaultSession["user"];
  }

  interface User {
    isSuperAdmin?: boolean;
    /** Set only by the Credentials authorize() callback, consumed once by the jwt callback. */
    sessionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isSuperAdmin?: boolean;
    roles?: string[];
    permissions?: string[];
    sessionId?: string;
  }
}

// next-auth/jwt re-exports @auth/core/jwt's JWT via `export *`, which does
// not carry declaration-merging augmentations back to the original module —
// the jwt callback's `token` param is typed against @auth/core/jwt directly,
// so the augmentation has to land here too.
declare module "@auth/core/jwt" {
  interface JWT {
    isSuperAdmin?: boolean;
    roles?: string[];
    permissions?: string[];
    sessionId?: string;
  }
}
