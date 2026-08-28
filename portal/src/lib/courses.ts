import { withRls } from "@/lib/rls";
import {
  AuthorizationError,
  PERMISSIONS,
  hasPermission,
  requirePermission,
  type AuthzActor,
  type PermissionKey,
} from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { isActiveOrganizationMember } from "@/lib/organizations";

/**
 * Education Core (Session 04) — Course, Cohort, CohortTeacher, Enrollment.
 *
 * Ownership model: Course -> Cohort -> Teacher(s) + Students. There is no
 * direct Course->Teacher link — a teacher's authority over a course's
 * content is always mediated through a cohort_teachers row on one of that
 * course's cohorts (see isCourseTeacher/requireCourseContentAccess below,
 * reused by src/lib/content.ts and src/lib/topics.ts). This mirrors the
 * RLS policies in the education_core migration, which enforce the exact
 * same ownership shape at the database level — the checks here are the
 * application-layer mirror, not a substitute for it.
 *
 * Organization-Aware Education (Session 21) — a Course may additionally be
 * ORGANIZATION-scoped (see CreateCourseInput.organizationId below); Cohort/
 * Assessment/Question denormalize organizationId from their course at
 * creation (immutable once set, same convention as lessons.courseId). A
 * PLATFORM course (organizationId null, the default) behaves exactly as
 * every course did before this session — see docs on the
 * organization_aware_education migration for the full RLS contract.
 */

/**
 * System-level context for lookups that must run independent of the
 * caller's own RLS visibility, after the caller has already been
 * authorized by requirePermission() — same convention as
 * organizations.ts's SYSTEM_CTX (isActiveOrganizationMember, etc.). Used
 * below by assignTeacherToCohort()/enrollStudent() to check whether an
 * arbitrary TARGET user (not the actor) holds a given role: the actor's
 * own RLS-scoped context has no reason to include visibility into another
 * user's user_roles row, so a plain (unscoped) prisma call here would
 * silently return zero rows under real RLS enforcement (production's
 * kf_portal_prod_app role does not bypass RLS — only the local dev
 * superuser connection does, which is why this was not caught locally).
 */
const SYSTEM_CTX = { isSuperAdmin: true } as const;

export function actorRlsCtx(actor: AuthzActor) {
  return {
    userId: actor.id,
    isSuperAdmin: actor.isSuperAdmin,
    permissions: [...actor.permissions],
    organizationIds: actor.organizationIds ? [...actor.organizationIds] : [],
  };
}

/** True when actor holds a cohort_teachers row for any cohort of this course. */
export async function isCourseTeacher(courseId: string, actor: AuthzActor): Promise<boolean> {
  const count = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohortTeacher.count({ where: { teacherUserId: actor.id, cohort: { courseId } } })
  );
  return count > 0;
}

/**
 * The shared content-authorization gate used by every Module/Lesson/
 * Resource/topic-tag mutation (src/lib/content.ts, src/lib/topics.ts).
 * super_admin and courses.manage holders bypass ownership entirely; a
 * courses.content.write/courses.content.publish holder must additionally
 * be a teacher on this specific course. Throws AuthorizationError on
 * failure — callers don't need to re-check the return value.
 */
export async function requireCourseContentAccess(
  courseId: string,
  actor: AuthzActor,
  key: PermissionKey
): Promise<void> {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.COURSES_MANAGE)) return;
  requirePermission(actor, key);
  if (!(await isCourseTeacher(courseId, actor))) {
    throw new AuthorizationError("Not assigned to teach this course");
  }
}

/**
 * Read-only variant: can this actor see the course at all (admin, teacher, or
 * super_admin)? Exported for Session 08 (Progress) to reuse for its
 * teacher-facing cohort/course progress reads — the exact same ownership
 * shape already used by getCourseById/listCohortsForCourse/
 * listEnrollmentsForCohort below, not a new check.
 */
export async function assertCanManageOrTeachCourse(courseId: string, actor: AuthzActor): Promise<void> {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.COURSES_MANAGE)) return;
  if (!(await isCourseTeacher(courseId, actor))) {
    throw new AuthorizationError("Not authorized");
  }
}

// --- Course ---------------------------------------------------------------

export interface CreateCourseInput {
  title: string;
  description?: string;
  /**
   * Organization-Aware Education (Session 21). Omitted/undefined (the
   * default) creates a PLATFORM-scoped course — every pre-Session-21
   * caller and test is unaffected. Supplying an organizationId creates an
   * ORGANIZATION-scoped course instead, visible only to that
   * organization's members plus courses.manage/super_admin (unchanged).
   * Still gated by courses.create only — this session does not grant
   * org_admin a course-creation capability of its own (see this session's
   * handoff "Known limitations").
   */
  organizationId?: string;
}

export async function createCourse(input: CreateCourseInput, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_CREATE);

  const course = await withRls(actorRlsCtx(actor), async (tx) => {
    if (input.organizationId) {
      const organization = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
      if (!organization) throw new Error("Organization not found");
    }
    return tx.course.create({
      data: {
        title: input.title,
        description: input.description ?? "",
        createdBy: actor.id,
        ...(input.organizationId ? { scope: "organization", organizationId: input.organizationId } : {}),
      },
    });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "course.created",
    entityType: "Course",
    entityId: course.id,
  });

  return course;
}

export interface UpdateCourseInput {
  title?: string;
  description?: string;
}

export async function updateCourseDetails(courseId: string, data: UpdateCourseInput, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);
  await withRls(actorRlsCtx(actor), (tx) => tx.course.update({ where: { id: courseId }, data }));
}

/** Course-level publish: draft/archived -> published. Emits CoursePublished. */
export async function publishCourse(courseId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.course.update({ where: { id: courseId }, data: { status: "published", publishedAt: new Date() } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "course.published", entityType: "Course", entityId: courseId });
  emitDomainEvent("CoursePublished", { courseId, actorId: actor.id });
}

export async function archiveCourse(courseId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.course.update({ where: { id: courseId }, data: { status: "archived" } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "course.archived", entityType: "Course", entityId: courseId });
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export interface ListCoursesFilter {
  status?: "draft" | "published" | "archived";
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Admin course directory. Requires courses.manage. */
export async function listCourses(filter: ListCoursesFilter, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = filter.search?.trim();

  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [courses, total] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.course.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { cohorts: true, modules: true } } },
      }),
      tx.course.count({ where }),
    ])
  );

  return { courses, total, page, pageSize };
}

/** A teacher's own course list, scoped via cohort_teachers. */
export async function listMyCourses(actor: AuthzActor) {
  if (
    !actor.isSuperAdmin &&
    !hasPermission(actor, PERMISSIONS.COURSES_MANAGE) &&
    !hasPermission(actor, PERMISSIONS.COURSES_CONTENT_WRITE) &&
    !hasPermission(actor, PERMISSIONS.COURSES_CONTENT_PUBLISH)
  ) {
    throw new AuthorizationError("Not authorized");
  }

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.course.findMany({
      where: { cohorts: { some: { teachers: { some: { teacherUserId: actor.id } } } } },
      orderBy: { createdAt: "desc" },
    })
  );
}

/** Requires courses.manage, super_admin, or being a teacher on the course. */
export async function getCourseById(courseId: string, actor: AuthzActor) {
  await assertCanManageOrTeachCourse(courseId, actor);
  return withRls(actorRlsCtx(actor), (tx) => tx.course.findUnique({ where: { id: courseId } }));
}

// --- Cohort -----------------------------------------------------------

export interface CreateCohortInput {
  name: string;
  startsAt?: Date;
  endsAt?: Date;
}

export async function createCohort(courseId: string, input: CreateCohortInput, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);

  const cohort = await withRls(actorRlsCtx(actor), async (tx) => {
    // Organization-Aware Education (Session 21): organizationId is
    // denormalized from the course at creation, immutable once set — see
    // this module's header comment.
    const course = await tx.course.findUniqueOrThrow({ where: { id: courseId }, select: { organizationId: true } });
    return tx.cohort.create({
      data: { courseId, name: input.name, startsAt: input.startsAt, endsAt: input.endsAt, organizationId: course.organizationId },
    });
  });

  await recordAuditEvent({ actorId: actor.id, action: "cohort.created", entityType: "Cohort", entityId: cohort.id, metadata: { courseId } });

  return cohort;
}

export async function archiveCohort(cohortId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);
  await withRls(actorRlsCtx(actor), (tx) => tx.cohort.update({ where: { id: cohortId }, data: { status: "archived" } }));
}

/** Requires courses.manage, super_admin, or being a teacher on the cohort's course. */
export async function listCohortsForCourse(courseId: string, actor: AuthzActor) {
  await assertCanManageOrTeachCourse(courseId, actor);
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.cohort.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
      include: { teachers: { include: { teacher: { select: { id: true, name: true, email: true } } } }, _count: { select: { enrollments: true } } },
    })
  );
}

// --- CohortTeacher ------------------------------------------------------

/**
 * Organization-Aware Education (Session 21). If cohortId's course is
 * ORGANIZATION-scoped, targetUserId must currently hold an ACTIVE
 * OrganizationMembership in that organization. Without this, a
 * courses.manage holder (unrestricted here on purpose — a Platform Admin's
 * cross-tenant reach is unchanged) could create a cohort_teachers/
 * enrollments row that the RLS policies this session added would then make
 * invisible to that target user and to any of their fellow non-member
 * teachers/students — a silently useless assignment rather than a real
 * authorization boundary. No-op for a PLATFORM-scoped cohort (every
 * pre-Session-21 assignment path is unaffected). Throws AuthorizationError
 * on failure.
 */
async function assertTargetIsOrgMemberIfScoped(cohortId: string, targetUserId: string, actor: AuthzActor): Promise<void> {
  const cohort = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohort.findUniqueOrThrow({ where: { id: cohortId }, select: { organizationId: true } })
  );
  if (!cohort.organizationId) return;
  if (!(await isActiveOrganizationMember(cohort.organizationId, targetUserId))) {
    throw new AuthorizationError("Target user is not an active member of this course's organization");
  }
}

/** Assigns a user holding the TEACHER role to a cohort. Requires courses.manage. */
export async function assignTeacherToCohort(cohortId: string, teacherUserId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);

  const holdsTeacherRole = await withRls(SYSTEM_CTX, (tx) =>
    tx.userRole.findFirst({
      where: { userId: teacherUserId, role: { name: "TEACHER" } },
    })
  );
  if (!holdsTeacherRole) throw new Error("Target user does not hold the TEACHER role");
  await assertTargetIsOrgMemberIfScoped(cohortId, teacherUserId, actor);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohortTeacher.upsert({
      where: { cohortId_teacherUserId: { cohortId, teacherUserId } },
      create: { cohortId, teacherUserId },
      update: {},
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "cohort.teacher_assigned",
    entityType: "Cohort",
    entityId: cohortId,
    metadata: { teacherUserId },
  });
}

export async function removeTeacherFromCohort(cohortId: string, teacherUserId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohortTeacher.deleteMany({ where: { cohortId, teacherUserId } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "cohort.teacher_removed",
    entityType: "Cohort",
    entityId: cohortId,
    metadata: { teacherUserId },
  });
}

// --- Enrollment ---------------------------------------------------------

/** Enrolls a user holding the STUDENT role into a cohort. Idempotent. Requires courses.manage. */
export async function enrollStudent(cohortId: string, studentUserId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);

  const holdsStudentRole = await withRls(SYSTEM_CTX, (tx) =>
    tx.userRole.findFirst({
      where: { userId: studentUserId, role: { name: "STUDENT" } },
    })
  );
  if (!holdsStudentRole) throw new Error("Target user does not hold the STUDENT role");
  await assertTargetIsOrgMemberIfScoped(cohortId, studentUserId, actor);

  const enrollment = await withRls(actorRlsCtx(actor), async (tx) => {
    const existing = await tx.enrollment.findUnique({
      where: { cohortId_studentUserId: { cohortId, studentUserId } },
    });
    if (existing) {
      if (existing.status === "withdrawn") {
        return tx.enrollment.update({
          where: { id: existing.id },
          data: { status: "active", withdrawnAt: null, enrolledAt: new Date() },
        });
      }
      return existing;
    }
    return tx.enrollment.create({ data: { cohortId, studentUserId, status: "active" } });
  });

  const cohort = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohort.findUniqueOrThrow({ where: { id: cohortId }, select: { courseId: true } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "student.enrolled",
    entityType: "Enrollment",
    entityId: enrollment.id,
    metadata: { cohortId, studentUserId },
  });
  emitDomainEvent("StudentEnrolled", { enrollmentId: enrollment.id, studentId: studentUserId, courseId: cohort.courseId });

  return enrollment;
}

export async function withdrawEnrollment(enrollmentId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.update({ where: { id: enrollmentId }, data: { status: "withdrawn", withdrawnAt: new Date() } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "student.withdrawn", entityType: "Enrollment", entityId: enrollmentId });
}

/** Requires courses.manage, super_admin, or being a teacher on the cohort's course. */
export async function listEnrollmentsForCohort(cohortId: string, actor: AuthzActor) {
  const cohort = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohort.findUnique({ where: { id: cohortId }, select: { courseId: true } })
  );
  if (!cohort) throw new Error("Cohort not found");
  await assertCanManageOrTeachCourse(cohort.courseId, actor);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findMany({
      where: { cohortId },
      orderBy: { enrolledAt: "desc" },
      include: { student: { select: { id: true, name: true, email: true } } },
    })
  );
}

/** A student's own enrollments — no permission required beyond self-scoping. */
export async function listMyEnrollments(actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findMany({
      where: { studentUserId: actor.id },
      orderBy: { enrolledAt: "desc" },
      include: { cohort: { include: { course: true } } },
    })
  );
}

/** Throws AuthorizationError unless actor has an active/completed enrollment in a cohort of this course. */
export async function assertActiveEnrollment(courseId: string, actor: AuthzActor): Promise<void> {
  const enrollment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findFirst({
      where: { studentUserId: actor.id, status: { in: ["active", "completed"] }, cohort: { courseId } },
    })
  );
  if (!enrollment) throw new AuthorizationError("Not enrolled in this course");
}
