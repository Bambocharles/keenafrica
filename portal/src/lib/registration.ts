import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { withRls } from "@/lib/rls";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import type { RoleName } from "@/lib/authz";

/**
 * Public self-service registration (Session 18 — B2B & B2C Onboarding).
 * Before this session there is no signup route anywhere in this repo:
 * every account is admin/seed-provisioned via src/lib/users.ts's
 * createUser(), which requires users.create. registerUser() is the ONLY
 * other path that may ever create a "users" row — the second, narrower
 * INSERT authorized by the self_registration migration's RLS policies
 * (app.self_registration), mirroring the existing pre-auth carve-out
 * convention (app.auth_lookup / app.password_reset_lookup /
 * app.rate_limit_lookup).
 *
 * This is deliberately NOT a second identity/session system
 * (CLAUDE_BUILD_RULES.md §3 / this session's "Must NOT"): it writes the
 * exact same "users"/"user_roles" tables createUser() does, using the same
 * bcrypt cost factor (12) as src/lib/users.ts/password-reset.ts. The
 * caller (a Server Action) is expected to sign the new account in
 * immediately afterward via Auth.js's existing Credentials provider
 * (src/lib/auth.ts) — registerUser() itself never creates a Session row.
 *
 * Only TEACHER/STUDENT/KEEN_AFRICAN are self-registerable — sessions/18-b2b-
 * b2c-onboarding.md's mission is explicitly "a new teacher or student";
 * ADMIN/TROUBLESHOOTER/SPONSOR_* accounts remain admin-provisioned only
 * (see src/lib/users.ts's createUser(), still users.create-gated,
 * untouched by this module). KEEN_AFRICAN added by Session 34 — same
 * "the subdomain IS the platform-role choice" convention, not
 * architecturally special beyond the role grant (see
 * sessions/34-keen-africans.md item 5).
 */

export const REGISTERABLE_ROLES: readonly RoleName[] = ["TEACHER", "STUDENT", "KEEN_AFRICAN"];
export type RegisterableRole = "TEACHER" | "STUDENT" | "KEEN_AFRICAN";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 12;

export interface RegisterUserInput {
  email: string;
  password: string;
  name: string;
  role: RegisterableRole;
}

export type RegisterUserOutcome =
  | { ok: true; userId: string; email: string; name: string }
  | { ok: false; error: "invalid_input" | "weak_password" | "invalid_role" | "email_taken" };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Creates a new User + single UserRole row, entirely outside the normal
 * authenticated-actor path (there is no actor yet). Always returns a typed
 * outcome rather than throwing for expected validation/collision failures,
 * so the calling Server Action can render a specific message without a
 * try/catch — the one exception is a genuinely unexpected DB error, which
 * still propagates.
 */
export async function registerUser(input: RegisterUserInput): Promise<RegisterUserOutcome> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!email || !EMAIL_RE.test(email) || !name) {
    return { ok: false, error: "invalid_input" };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "weak_password" };
  }
  if (!REGISTERABLE_ROLES.includes(input.role)) {
    return { ok: false, error: "invalid_role" };
  }

  const passwordHash = await hash(input.password, BCRYPT_COST);

  try {
    const user = await withRls({ selfRegistration: true }, async (tx) => {
      const role = await tx.role.findUnique({ where: { name: input.role } });
      if (!role) throw new Error(`Role not seeded: ${input.role}`);

      return tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          userRoles: { create: [{ roleId: role.id }] },
        },
        select: { id: true, email: true, name: true },
      });
    });

    await recordAuditEvent({
      actorId: user.id,
      action: "user.registered",
      entityType: "User",
      entityId: user.id,
      metadata: { role: input.role, selfService: true },
    });
    emitDomainEvent("UserCreated", { userId: user.id });

    return { ok: true, userId: user.id, email: user.email, name: user.name };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "email_taken" };
    }
    throw err;
  }
}

export interface RegisterUserViaProviderInput {
  email: string;
  name: string;
  role: RegisterableRole;
}

export type RegisterUserViaProviderOutcome =
  | { ok: true; userId: string; email: string; name: string }
  | { ok: false; error: "invalid_input" | "invalid_role" | "email_taken" };

/**
 * Federated-auth counterpart to registerUser() (Session 19) — same
 * self_registration RLS carve-out, same REGISTERABLE_ROLES gate, same
 * "the only two paths that may INSERT a users row" boundary. The one
 * difference: no password at all (passwordHash: null — see schema.prisma's
 * comment on User.passwordHash), since the account is authenticated
 * entirely via the linked provider identity created right after this call
 * (src/lib/oauth-identity.ts's resolveGoogleSignIn()). Never called
 * directly by a Server Action the way registerUser() is — only from that
 * one caller, which already validated the requested role against the
 * subdomain the sign-in happened on.
 */
export async function registerUserViaProvider(
  input: RegisterUserViaProviderInput
): Promise<RegisterUserViaProviderOutcome> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim() || email;

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: "invalid_input" };
  }
  if (!REGISTERABLE_ROLES.includes(input.role)) {
    return { ok: false, error: "invalid_role" };
  }

  try {
    const user = await withRls({ selfRegistration: true }, async (tx) => {
      const role = await tx.role.findUnique({ where: { name: input.role } });
      if (!role) throw new Error(`Role not seeded: ${input.role}`);

      return tx.user.create({
        data: {
          email,
          name,
          passwordHash: null,
          userRoles: { create: [{ roleId: role.id }] },
        },
        select: { id: true, email: true, name: true },
      });
    });

    await recordAuditEvent({
      actorId: user.id,
      action: "user.registered",
      entityType: "User",
      entityId: user.id,
      metadata: { role: input.role, selfService: true, provider: "google" },
    });
    emitDomainEvent("UserCreated", { userId: user.id });

    return { ok: true, userId: user.id, email: user.email, name: user.name };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "email_taken" };
    }
    throw err;
  }
}
