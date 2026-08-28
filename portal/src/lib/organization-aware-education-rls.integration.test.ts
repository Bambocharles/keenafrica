import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Organization-Aware Education (Session 21) — proves the
 * organization_aware_education migration's RLS changes are enforced by
 * Postgres itself, against the real non-superuser portal_rls_test role
 * (see src/lib/rls.integration.test.ts's header comment for why the
 * default superuser-backed DATABASE_URL can't prove this).
 *
 * Fixture shape: TWO courses — one PLATFORM-scoped (organization_id null,
 * exactly like every course before this session), one ORGANIZATION-scoped
 * to "Org A". For the organization-scoped cohort, BOTH a member and a
 * non-member teacher/student are given a real cohort_teachers/enrollments
 * row via a raw (superuser, RLS-bypassing) insert — i.e. the fixture
 * deliberately simulates the write-time application-layer integrity check
 * (src/lib/courses.ts's assertTargetIsOrgMemberIfScoped) having been
 * bypassed or never having run, so these tests prove the RLS backstop
 * holds on its own, independent of that application-layer guard.
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Organization-Aware Education Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean; permissions?: string[]; organizationIds?: string[] },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_ids', ${JSON.stringify(ctx.organizationIds ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.org_invitation_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.self_registration', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.mfa_login_lookup', 'false', true)`;
      return fn(tx);
    });
  }

  let admin: { id: string };
  let orgAId: string;
  let orgBId: string;
  let memberTeacher: { id: string };
  let outsiderTeacher: { id: string };
  let memberStudent: { id: string };
  let outsiderStudent: { id: string };

  let platformCourseId: string;
  let platformCohortId: string;

  let orgCourseId: string;
  let orgCohortId: string;
  let orgModuleId: string;
  let orgAssessmentId: string;
  let orgQuestionId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `org-edu-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    admin = await mk("admin");
    memberTeacher = await mk("member-teacher");
    outsiderTeacher = await mk("outsider-teacher");
    memberStudent = await mk("member-student");
    outsiderStudent = await mk("outsider-student");

    const orgA = await setup.organization.create({
      data: { name: "RLS Org A", slug: `rls-org-a-${randomUUID()}`, createdBy: admin.id },
      select: { id: true },
    });
    orgAId = orgA.id;
    const orgB = await setup.organization.create({
      data: { name: "RLS Org B", slug: `rls-org-b-${randomUUID()}`, createdBy: admin.id },
      select: { id: true },
    });
    orgBId = orgB.id;

    // memberTeacher/memberStudent are ACTIVE members of Org A.
    // outsiderTeacher/outsiderStudent are members of Org B instead (proving
    // this isn't merely "has no organization at all" but a genuine
    // cross-organization case), NOT Org A.
    await setup.organizationMembership.createMany({
      data: [
        { organizationId: orgAId, userId: memberTeacher.id, role: "org_member", status: "active", joinedAt: new Date() },
        { organizationId: orgAId, userId: memberStudent.id, role: "org_member", status: "active", joinedAt: new Date() },
        { organizationId: orgBId, userId: outsiderTeacher.id, role: "org_member", status: "active", joinedAt: new Date() },
        { organizationId: orgBId, userId: outsiderStudent.id, role: "org_member", status: "active", joinedAt: new Date() },
      ],
    });

    // --- PLATFORM-scoped course (regression fixture) ---
    const platformCourse = await setup.course.create({
      data: { title: "RLS Platform Course", createdBy: admin.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    platformCourseId = platformCourse.id;
    const platformCohort = await setup.cohort.create({
      data: { courseId: platformCourseId, name: "Platform Cohort" },
      select: { id: true },
    });
    platformCohortId = platformCohort.id;
    // outsiderTeacher/outsiderStudent (Org B members, no relation to Org A)
    // teach/attend the PLATFORM cohort — proves organization membership is
    // irrelevant to platform-course visibility, exactly as before Session 21.
    await setup.cohortTeacher.create({ data: { cohortId: platformCohortId, teacherUserId: outsiderTeacher.id } });
    await setup.enrollment.create({ data: { cohortId: platformCohortId, studentUserId: outsiderStudent.id, status: "active" } });

    // --- ORGANIZATION-scoped course (Org A) ---
    const orgCourse = await setup.course.create({
      data: {
        title: "RLS Org-Scoped Course",
        createdBy: admin.id,
        status: "published",
        publishedAt: new Date(),
        scope: "organization",
        organizationId: orgAId,
      },
      select: { id: true },
    });
    orgCourseId = orgCourse.id;
    const orgCohort = await setup.cohort.create({
      data: { courseId: orgCourseId, name: "Org Cohort", organizationId: orgAId },
      select: { id: true },
    });
    orgCohortId = orgCohort.id;

    // Deliberately give BOTH the member AND the outsider a real row —
    // simulating the app-layer integrity check having been bypassed, so
    // these tests prove RLS alone (not just assertTargetIsOrgMemberIfScoped)
    // closes the gap.
    await setup.cohortTeacher.createMany({
      data: [
        { cohortId: orgCohortId, teacherUserId: memberTeacher.id },
        { cohortId: orgCohortId, teacherUserId: outsiderTeacher.id },
      ],
    });
    await setup.enrollment.createMany({
      data: [
        { cohortId: orgCohortId, studentUserId: memberStudent.id, status: "active" },
        { cohortId: orgCohortId, studentUserId: outsiderStudent.id, status: "active" },
      ],
    });

    const orgModule = await setup.module.create({
      data: { courseId: orgCourseId, title: "Org Module", order: 0, status: "published" },
      select: { id: true },
    });
    orgModuleId = orgModule.id;

    const orgAssessment = await setup.assessment.create({
      data: { courseId: orgCourseId, organizationId: orgAId, title: "Org Assessment", status: "published", createdBy: admin.id },
      select: { id: true },
    });
    orgAssessmentId = orgAssessment.id;

    const orgQuestion = await setup.question.create({
      data: { courseId: orgCourseId, organizationId: orgAId, type: "short_answer", prompt: "Org Q", createdBy: admin.id },
      select: { id: true },
    });
    orgQuestionId = orgQuestion.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.question.deleteMany({ where: { courseId: { in: [orgCourseId] } } });
    await setup.assessment.deleteMany({ where: { courseId: { in: [orgCourseId] } } });
    await setup.module.deleteMany({ where: { courseId: { in: [orgCourseId] } } });
    await setup.enrollment.deleteMany({ where: { cohortId: { in: [platformCohortId, orgCohortId] } } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId: { in: [platformCohortId, orgCohortId] } } });
    await setup.cohort.deleteMany({ where: { id: { in: [platformCohortId, orgCohortId] } } });
    await setup.course.deleteMany({ where: { id: { in: [platformCourseId, orgCourseId] } } });
    await setup.organizationMembership.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await setup.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
    await setup.user.deleteMany({
      where: { id: { in: [admin.id, memberTeacher.id, outsiderTeacher.id, memberStudent.id, outsiderStudent.id] } },
    });
    await setup.$disconnect();
    await client.$disconnect();
  });

  describe("REGRESSION: PLATFORM-scoped course visibility is provably unchanged", () => {
    it("courses_select/cohorts_select: an assigned teacher with NO organization membership at all still sees the platform course/cohort", async () => {
      const courses = await asContext({ userId: outsiderTeacher.id, organizationIds: [] }, (tx) =>
        tx.course.findMany({ where: { id: platformCourseId } })
      );
      expect(courses).toHaveLength(1);
      const cohorts = await asContext({ userId: outsiderTeacher.id, organizationIds: [] }, (tx) =>
        tx.cohort.findMany({ where: { id: platformCohortId } })
      );
      expect(cohorts).toHaveLength(1);
    });

    it("courses_select: an enrolled student with NO organization membership still sees the published platform course", async () => {
      const rows = await asContext({ userId: outsiderStudent.id, organizationIds: [] }, (tx) =>
        tx.course.findMany({ where: { id: platformCourseId } })
      );
      expect(rows).toHaveLength(1);
    });

    it("courses_select: the platform course is visible REGARDLESS of the caller's own (unrelated) organization memberships", async () => {
      // outsiderTeacher happens to be an active Org B member — proves the
      // new organization_id IS NULL branch doesn't accidentally start
      // requiring ANY membership, just tolerates one being present.
      const rows = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.course.findMany({ where: { id: platformCourseId } })
      );
      expect(rows).toHaveLength(1);
    });

    it("enrollments_select: the platform cohort's teacher sees its enrollment with no organization membership", async () => {
      const rows = await asContext({ userId: outsiderTeacher.id, organizationIds: [] }, (tx) =>
        tx.enrollment.findMany({ where: { cohortId: platformCohortId } })
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe("ORGANIZATION-scoped course: visible only to members of that organization", () => {
    it("courses_select: the Org A member teacher sees the org-scoped course; a non-member (Org B) teacher does not, despite holding the same cohort_teachers row", async () => {
      const memberRows = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(memberRows).toHaveLength(1);

      const outsiderRows = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(outsiderRows).toHaveLength(0);
    });

    it("courses_select: the Org A member student sees the org-scoped course; a non-member (Org B) student does not, despite holding the same enrollment row", async () => {
      const memberRows = await asContext({ userId: memberStudent.id, organizationIds: [orgAId] }, (tx) =>
        tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(memberRows).toHaveLength(1);

      const outsiderRows = await asContext({ userId: outsiderStudent.id, organizationIds: [orgBId] }, (tx) =>
        tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(outsiderRows).toHaveLength(0);
    });

    it("cohorts_select: same member/non-member split as courses_select", async () => {
      const memberRows = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.cohort.findMany({ where: { id: orgCohortId } })
      );
      expect(memberRows).toHaveLength(1);

      const outsiderRows = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.cohort.findMany({ where: { id: orgCohortId } })
      );
      expect(outsiderRows).toHaveLength(0);
    });

    it("enrollments_select (teacher branch): a non-member teacher sees none of the org cohort's enrollments; the member teacher sees both", async () => {
      const outsiderRows = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.enrollment.findMany({ where: { cohortId: orgCohortId } })
      );
      expect(outsiderRows).toHaveLength(0);

      const memberRows = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.enrollment.findMany({ where: { cohortId: orgCohortId } })
      );
      expect(memberRows).toHaveLength(2);
    });

    it("modules_select CASCADES from the cohorts_select fix without any direct change to modules_select itself", async () => {
      const outsiderRows = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.module.findMany({ where: { id: orgModuleId } })
      );
      expect(outsiderRows).toHaveLength(0);

      const memberRows = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.module.findMany({ where: { id: orgModuleId } })
      );
      expect(memberRows).toHaveLength(1);
    });

    it("assessments_select/questions_select: a non-member teacher sees neither; the member teacher sees both", async () => {
      const outsiderAssessments = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.assessment.findMany({ where: { id: orgAssessmentId } })
      );
      expect(outsiderAssessments).toHaveLength(0);
      const outsiderQuestions = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.question.findMany({ where: { id: orgQuestionId } })
      );
      expect(outsiderQuestions).toHaveLength(0);

      const memberAssessments = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.assessment.findMany({ where: { id: orgAssessmentId } })
      );
      expect(memberAssessments).toHaveLength(1);
      const memberQuestions = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.question.findMany({ where: { id: orgQuestionId } })
      );
      expect(memberQuestions).toHaveLength(1);
    });

    it("REGRESSION: a Platform Admin's (courses.manage) cross-tenant reach into the org-scoped course is unchanged — sees it with no organization membership at all", async () => {
      const courses = await asContext({ userId: admin.id, permissions: ["courses.manage"], organizationIds: [] }, (tx) =>
        tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(courses).toHaveLength(1);
      const cohorts = await asContext({ userId: admin.id, permissions: ["courses.manage"], organizationIds: [] }, (tx) =>
        tx.cohort.findMany({ where: { id: orgCohortId } })
      );
      expect(cohorts).toHaveLength(1);
      const enrollments = await asContext({ userId: admin.id, permissions: ["courses.manage"], organizationIds: [] }, (tx) =>
        tx.enrollment.findMany({ where: { cohortId: orgCohortId } })
      );
      expect(enrollments).toHaveLength(2);
      const assessments = await asContext({ userId: admin.id, permissions: ["courses.manage"], organizationIds: [] }, (tx) =>
        tx.assessment.findMany({ where: { id: orgAssessmentId } })
      );
      expect(assessments).toHaveLength(1);
    });

    it("REGRESSION: super_admin sees the org-scoped course/cohort with no organization membership at all", async () => {
      const courses = await asContext({ userId: admin.id, isSuperAdmin: true, organizationIds: [] }, (tx) =>
        tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(courses).toHaveLength(1);
    });
  });
});
