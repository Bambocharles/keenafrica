import { withRls } from "@/lib/rls";
import { PERMISSIONS, requirePermission, type AuthzActor } from "@/lib/authz";
import { ROLE_NAMES } from "@/lib/authz";

export interface AdminSystemStatus {
  usersByRole: Array<{ role: string; count: number }>;
  usersActive: number;
  usersSuspended: number;
  activeSessions: number;
  featureFlagsEnabled: number;
  featureFlagsTotal: number;
  sponsors: number;
  projects: number;
  courses: number;
  cohorts: number;
  enrollments: number;
}

/**
 * Admin dashboard's "system status" panel (Session 03 — "view system
 * status" in sessions/03-admin.md). A lightweight read aggregate over
 * existing tables, not a new subsystem — if the queries below resolve at
 * all, that alone demonstrates DB connectivity. Requires users.read (the
 * role breakdown is user data); every ADMIN_CONSOLE_ROLES role holds it.
 */
export async function getSystemStatus(actor: AuthzActor): Promise<AdminSystemStatus> {
  requirePermission(actor, PERMISSIONS.USERS_READ);

  const rlsCtx = { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] };

  return withRls(rlsCtx, async (tx) => {
    const [roleCounts, usersActive, usersSuspended, activeSessions, flags, sponsors, projects, courses, cohorts, enrollments] =
      await Promise.all([
        Promise.all(
          ROLE_NAMES.map(async (role) => ({
            role,
            count: await tx.userRole.count({ where: { role: { name: role } } }),
          }))
        ),
        tx.user.count({ where: { status: "active" } }),
        tx.user.count({ where: { status: "suspended" } }),
        tx.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
        tx.featureFlag.findMany({ select: { enabled: true } }),
        tx.sponsor.count(),
        tx.project.count(),
        tx.course.count(),
        tx.cohort.count(),
        tx.enrollment.count(),
      ]);

    return {
      usersByRole: roleCounts,
      usersActive,
      usersSuspended,
      activeSessions,
      featureFlagsEnabled: flags.filter((f) => f.enabled).length,
      featureFlagsTotal: flags.length,
      sponsors,
      projects,
      courses,
      cohorts,
      enrollments,
    };
  });
}
