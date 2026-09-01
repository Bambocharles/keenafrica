/**
 * Roles/permissions contract — Session 02 (Identity & Security).
 *
 * isSuperAdmin (on User, and as the RLS bypass in every table's policies)
 * is unchanged and remains the root escape hatch. Role/Permission is an
 * additive, finer-grained layer on top of it for non-super-admin actors
 * (ADMIN, TROUBLESHOOTER, TEACHER, STUDENT, SPONSOR_ADMIN, SPONSOR_USER).
 * A super admin implicitly holds every permission below regardless of any
 * Role row — see hasPermission().
 */

export const ROLE_NAMES = [
  "SUPER_ADMIN",
  "ADMIN",
  "TROUBLESHOOTER",
  "TEACHER",
  "STUDENT",
  "SPONSOR_ADMIN",
  "SPONSOR_USER",
  // Added by Session 34 (Keen Africans) — granted automatically on
  // registration through the keenafricans.<root> signup flow only (see
  // src/lib/registration.ts's REGISTERABLE_ROLES). Deliberately NOT tied to
  // Organization Core: an individual publishing under their own name isn't
  // institutional tenancy.
  "KEEN_AFRICAN",
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * Action-oriented permission keys, per PLATFORM_ARCHITECTURE.md §6. Only
 * keys for capabilities that exist *today* are seeded — Education/Sponsor
 * Core permissions (courses.*, assessments.*, sponsor.*) belong to the
 * sessions that build those entities, added the same way: extend this
 * list + the role_permissions seed, never a parallel permission table.
 */
export const PERMISSIONS = {
  USERS_READ: "users.read",
  USERS_CREATE: "users.create",
  USERS_UPDATE: "users.update",
  USERS_SUSPEND: "users.suspend",
  ROLES_MANAGE: "roles.manage",
  SESSIONS_READ: "sessions.read",
  SESSIONS_REVOKE: "sessions.revoke",
  AUDIT_READ: "audit.read",
  // Added by Session 03 (Admin) — Session 01's feature_flags table shipped
  // super-admin-only write with this key explicitly anticipated for the
  // admin UI over it (see docs/FEATURE_FLAGS.md "Toggling a flag today").
  FLAGS_MANAGE: "flags.manage",
  // Added by Session 04 (Education Core). courses.manage is the admin
  // "full course/cohort/enrollment management" key; courses.publish gates
  // only the COURSE-level draft->published->archived lifecycle (kept
  // separate from courses.manage per PLATFORM_ARCHITECTURE.md §6's
  // explicit courses.publish example). courses.content.write/
  // courses.content.publish gate Module/Lesson/Resource/topic-tag
  // authoring and publishing and are always ownership-scoped in
  // application code AND at the RLS layer: a holder must also be a
  // cohort_teachers row for a cohort of that course (see
  // src/lib/courses.ts's isCourseTeacher()) unless they also hold
  // courses.manage or are super_admin. topics.manage guards the shared
  // Subject/Topic/Skill taxonomy (a catalog table, public-read).
  COURSES_CREATE: "courses.create",
  COURSES_MANAGE: "courses.manage",
  COURSES_PUBLISH: "courses.publish",
  COURSES_CONTENT_WRITE: "courses.content.write",
  COURSES_CONTENT_PUBLISH: "courses.content.publish",
  TOPICS_MANAGE: "topics.manage",
  // Added by Session 09 (Messaging). messages.send is necessary but not
  // sufficient to start a conversation — src/lib/messaging.ts's
  // assertCanMessage() additionally requires a real teacher/student
  // relationship (a shared cohort, via Session 04's canonical
  // CohortTeacher/Enrollment tables), the same "permission + ownership/
  // relationship" shape as courses.content.write + cohort_teachers.
  // messages.admin bypasses that relationship check entirely — the "Admin
  // -> permitted users" required use case (sessions/09-messaging.md).
  MESSAGES_SEND: "messages.send",
  MESSAGES_ADMIN: "messages.admin",
  // Added by Session 11 (Sponsor). sponsor.manage is the admin/staff "full
  // sponsor-core management" key — sponsors/projects/milestones/metrics/
  // documents/any project's membership (ADMIN/SUPER_ADMIN only, via
  // ALL_PERMISSION_KEYS, same as courses.manage/flags.manage). The
  // sponsor-portal side is ownership-scoped exactly like TEACHER's
  // courses.content.write: sponsor.projects.read is necessary but not
  // sufficient without a matching project_memberships row (see
  // src/lib/sponsor.ts's requireProjectSponsorAccess) — mirrors
  // isCourseTeacher/requireCourseContentAccess. sponsor.users.manage lets a
  // SPONSOR_ADMIN invite/remove other sponsor-team members (role='sponsor_admin'
  // ProjectMembership rows only, never a beneficiary row) on a project they
  // themselves are already on.
  SPONSOR_MANAGE: "sponsor.manage",
  SPONSOR_PROJECTS_READ: "sponsor.projects.read",
  SPONSOR_USERS_MANAGE: "sponsor.users.manage",
  // Added by Session 14 (Certificates). Gates admin verification/management
  // (issuing is NOT gated by this on the student side — see below) AND is
  // the ONLY permission src/lib/certificates.ts's internal
  // systemCertificateCtx() ever carries when it writes a certificates row.
  // No STUDENT or TEACHER role holds this (see DEFAULT_ROLE_PERMISSIONS
  // below) — a real actor's own permission set can never satisfy
  // certificates_write/update's RLS policy, only this module's own narrow
  // system context can, which is never exposed to a real actor's request.
  CERTIFICATES_MANAGE: "certificates.manage",
  // Added by Session 17 (Organization Core). The global "manage every
  // organization" key (ADMIN/SUPER_ADMIN, via ALL_PERMISSION_KEYS) — a
  // Platform Admin's cross-tenant reach, deliberately separate from an
  // Organization Admin's reach (an OrganizationMembership row with
  // role='org_admin', scoped to ONE organization by
  // src/lib/organizations.ts's requireOrgPermission). Holding this is
  // necessary and sufficient for any organization; holding org_admin
  // membership is necessary and sufficient for exactly that one
  // organization — the same "global permission vs. ownership row" shape
  // courses.manage/sponsor.manage already use. No TEACHER/STUDENT/
  // SPONSOR_* role holds this by default (see DEFAULT_ROLE_PERMISSIONS) —
  // organization-scoped capability comes entirely from org_admin
  // membership, never from a global Role.
  ORGANIZATIONS_MANAGE: "organizations.manage",
  // Added by Session 34 (Keen Africans). articles.write is ownership-scoped
  // in practice, same shape as courses.content.write/sponsor.projects.read:
  // holding it only lets src/lib/articles.ts's mutations touch a row whose
  // author_id already matches the actor (both in application code AND at
  // the RLS layer — see the keen_africans_articles migration). articles.manage
  // is the admin/moderation key (ADMIN/SUPER_ADMIN, via ALL_PERMISSION_KEYS):
  // read/edit/unpublish ANY article, the "no pre-publish review" safety
  // valve this session's brief requires.
  ARTICLES_WRITE: "articles.write",
  ARTICLES_MANAGE: "articles.manage",
  // Added by Session 40 (Keen Africans — LinkedIn Verification). A
  // deliberately SEPARATE key from articles.manage, not a reuse of it —
  // sessions/41-keen-africans-admin-moderation.md's own brief explicitly
  // asks not to assume article moderators and identity reviewers are the
  // same people without confirming with the site owner. Kept decoupled so
  // that can be decided later (a distinct reviewer role/person) with zero
  // migration; today ADMIN/SUPER_ADMIN hold both keys via
  // ALL_PERMISSION_KEYS, same as every other admin-only capability.
  VERIFICATION_REVIEW: "verification.review",
} as const;
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS);

/**
 * Least-privilege default role -> permission map, seeded by
 * prisma/seed/tasks/roles-permissions.ts. TEACHER/STUDENT/SPONSOR_ADMIN/
 * SPONSOR_USER intentionally get none of these — they'll get their own
 * domain permissions (courses.*, sponsor.*, ...) from the sessions that
 * own those entities.
 *
 * TROUBLESHOOTER is deliberately narrower than ADMIN: read + session
 * revocation for diagnostics/incident response, never users.update/
 * users.suspend/roles.manage. Matches sessions/02-identity-security.md's
 * "Troubleshooters get only least-privilege diagnostic/security
 * capabilities."
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  ADMIN: ALL_PERMISSION_KEYS,
  TROUBLESHOOTER: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.SESSIONS_READ,
    PERMISSIONS.SESSIONS_REVOKE,
    PERMISSIONS.AUDIT_READ,
  ],
  // Ownership-scoped in practice: a TEACHER only gets to exercise these on
  // courses where they hold a cohort_teachers row (see courses.ts). Holding
  // the permission with no matching cohort assignment grants nothing.
  TEACHER: [PERMISSIONS.COURSES_CONTENT_WRITE, PERMISSIONS.COURSES_CONTENT_PUBLISH, PERMISSIONS.MESSAGES_SEND],
  STUDENT: [PERMISSIONS.MESSAGES_SEND],
  // Ownership-scoped in practice, same shape as TEACHER above: holding
  // these with no matching project_memberships row (role='sponsor_admin')
  // grants nothing — see src/lib/sponsor.ts.
  SPONSOR_ADMIN: [PERMISSIONS.SPONSOR_PROJECTS_READ, PERMISSIONS.SPONSOR_USERS_MANAGE],
  SPONSOR_USER: [PERMISSIONS.SPONSOR_PROJECTS_READ],
  // Ownership-scoped in practice, same shape as TEACHER/SPONSOR_ADMIN above:
  // holding articles.write with no matching author_id row grants nothing.
  KEEN_AFRICAN: [PERMISSIONS.ARTICLES_WRITE],
};

/**
 * Roles that may reach the admin console shell at all
 * (`src/app/admin/(protected)/layout.tsx`). This is the coarse "can see the
 * console" gate only — every page/action inside still enforces its own
 * requirePermission()/requireOwnResourceOrPermission() check, per
 * CLAUDE_BUILD_RULES.md §5 ("a user must not gain access merely because a
 * UI route is hidden"). TROUBLESHOOTER is intentionally included here (it's
 * a diagnostic console role) even though it holds far fewer permissions
 * than ADMIN.
 */
export const ADMIN_CONSOLE_ROLES: readonly RoleName[] = ["SUPER_ADMIN", "ADMIN", "TROUBLESHOOTER"];

/** The minimal shape a session needs for the admin-console entry check. */
export interface AdminConsoleActor {
  isSuperAdmin: boolean;
  roles: readonly string[];
}

export function canAccessAdminConsole(actor: AdminConsoleActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.roles.some((r) => (ADMIN_CONSOLE_ROLES as readonly string[]).includes(r));
}

/**
 * Session 05 (Teacher) — the coarse "can see the teacher workspace shell"
 * gate, same shape as canAccessAdminConsole(). Only TEACHER (plus the
 * isSuperAdmin bypass, for support/debugging) may reach it — this is not a
 * substitute for the ownership-scoped checks in courses.ts/content.ts, which
 * every page/action inside the workspace still enforces per course/cohort.
 */
export const TEACHER_PORTAL_ROLES: readonly RoleName[] = ["TEACHER"];

export function canAccessTeacherPortal(actor: AdminConsoleActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.roles.some((r) => (TEACHER_PORTAL_ROLES as readonly string[]).includes(r));
}

/**
 * Added by Session 06 (Student). Coarse "can see the student portal shell"
 * gate, same shape as canAccessAdminConsole() — every page/action inside
 * still enforces its own ownership check (listMyEnrollments/
 * getCourseContentForStudent's assertActiveEnrollment, notes/bookmarks'
 * self-scoping), so this alone grants no data access. isSuperAdmin is
 * included only so an operator can smoke-test the shell; a super admin has
 * no enrollments of their own and so sees only empty states beyond it.
 */
export const STUDENT_PORTAL_ROLES: readonly RoleName[] = ["STUDENT"];

export function canAccessStudentPortal(actor: AdminConsoleActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.roles.some((r) => (STUDENT_PORTAL_ROLES as readonly string[]).includes(r));
}

/**
 * Added by Session 11 (Sponsor). Coarse "can see the sponsor portal shell"
 * gate, same shape as canAccessStudentPortal(). Grants nothing on its
 * own — every page/action inside still enforces sponsor.projects.read PLUS
 * a project_memberships ownership row per project (src/lib/sponsor.ts). A
 * SPONSOR_ADMIN/SPONSOR_USER with zero project memberships reaches the
 * shell and sees only empty states, same as a teacher with no cohort
 * assignment.
 */
export const SPONSOR_PORTAL_ROLES: readonly RoleName[] = ["SPONSOR_ADMIN", "SPONSOR_USER"];

export function canAccessSponsorPortal(actor: AdminConsoleActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.roles.some((r) => (SPONSOR_PORTAL_ROLES as readonly string[]).includes(r));
}

/**
 * Added by Session 34 (Keen Africans). Coarse "can see the author dashboard
 * shell" gate, same shape as canAccessSponsorPortal(). Grants nothing on its
 * own — every page/action inside still enforces articles.write PLUS
 * author_id ownership per article (src/lib/articles.ts), same "permission +
 * ownership" shape as courses.content.write/cohort_teachers.
 */
export const KEEN_AFRICAN_PORTAL_ROLES: readonly RoleName[] = ["KEEN_AFRICAN"];

export function canAccessKeenAfricanPortal(actor: AdminConsoleActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.roles.some((r) => (KEEN_AFRICAN_PORTAL_ROLES as readonly string[]).includes(r));
}

/** The minimal shape any caller (session.user, a test fixture) needs. */
export interface AuthzActor {
  id: string;
  isSuperAdmin: boolean;
  permissions: readonly string[];
  /**
   * MFA & Account Security (Session 20) — the DB-backed sessions.id this
   * request's session corresponds to (src/lib/sessions.ts), needed by
   * src/lib/mfa.ts's requireStepUp()/verifyStepUp() to read/write that
   * row's step_up_verified_at. Always session.user.sessionId in a real
   * request (already resolved server-side by auth.ts's jwt/session
   * callbacks — see src/types/next-auth.d.ts — never client-suppliable).
   * Optional because non-request actors (system contexts, some test
   * fixtures) have no session row at all; requireStepUp() throws if it's
   * missing, the same fail-closed shape as a missing permission.
   */
  sessionId?: string;
  /**
   * Organization-Aware Education (Session 21) / Organization Core
   * (Session 17) — the organization ids the caller holds an ACTIVE
   * OrganizationMembership in, server-resolved by
   * src/lib/sessions.ts's resolveSessionAuthz() and always present on a
   * real session.user (see src/types/next-auth.d.ts). Optional here so
   * the many existing AuthzActor-typed callers/fixtures that predate
   * Session 17 (src/lib/test-support.ts's actorFromUser(), certificates.ts's
   * synthetic actors) still type-check with no organization membership at
   * all — src/lib/courses.ts's actorRlsCtx() treats a missing value as `[]`,
   * same convention as src/lib/organizations.ts's OrgActor.
   */
  organizationIds?: readonly string[];
}

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasPermission(actor: AuthzActor | null | undefined, key: PermissionKey): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.permissions.includes(key);
}

/** Throws AuthorizationError when the actor lacks the permission. */
export function requirePermission(actor: AuthzActor | null | undefined, key: PermissionKey): AuthzActor {
  if (!actor) throw new AuthorizationError("Not authenticated");
  if (!hasPermission(actor, key)) {
    throw new AuthorizationError(`Missing permission: ${key}`);
  }
  return actor;
}

/** True when the actor is the resource owner OR holds the permission. */
export function canActOnOwnResource(
  actor: AuthzActor | null | undefined,
  resourceOwnerId: string,
  key: PermissionKey
): boolean {
  if (!actor) return false;
  return actor.id === resourceOwnerId || hasPermission(actor, key);
}

/** Throws AuthorizationError unless the actor owns the resource or holds the permission. */
export function requireOwnResourceOrPermission(
  actor: AuthzActor | null | undefined,
  resourceOwnerId: string,
  key: PermissionKey
): AuthzActor {
  if (!actor) throw new AuthorizationError("Not authenticated");
  if (!canActOnOwnResource(actor, resourceOwnerId, key)) {
    throw new AuthorizationError(`Missing permission: ${key}`);
  }
  return actor;
}
