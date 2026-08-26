import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthzActor, RoleName } from "@/lib/authz";

/**
 * Shared fixtures for the integration test suites (sessions/users/password-
 * reset). Writes directly via the raw `prisma` singleton — in local dev
 * this is the Postgres superuser connection (bypasses RLS), which is fine
 * here: these suites test the application-layer authorization logic in
 * src/lib/*.ts, not the RLS backstop itself (see rls.integration.test.ts
 * for that, against a real non-superuser role).
 */

// Cost factor 4 (bcrypt's minimum) — these are throwaway test passwords,
// not real credentials; the default cost factor (12, see users.ts) would
// make every test file take noticeably longer for no security benefit here.
const TEST_BCRYPT_COST = 4;

export async function createTestUser(
  opts: { roles?: RoleName[]; status?: "active" | "suspended" } = {}
) {
  const passwordHash = await hash("Test1234!", TEST_BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email: `test-${randomUUID()}@example.com`,
      name: "Test User",
      passwordHash,
      status: opts.status ?? "active",
    },
  });

  if (opts.roles?.length) {
    const roleRows = await prisma.role.findMany({ where: { name: { in: opts.roles } } });
    await prisma.userRole.createMany({
      data: roleRows.map((r) => ({ userId: user.id, roleId: r.id })),
    });
  }

  return user;
}

/** Resolves the same {id, isSuperAdmin, permissions} shape the jwt callback computes. */
export async function actorFromUser(userId: string): Promise<AuthzActor> {
  const [user, userRoles] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    }),
  ]);
  const permissions = Array.from(
    new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)))
  );
  return { id: user.id, isSuperAdmin: user.isSuperAdmin, permissions };
}

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] },
  });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
