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
  let orgAssessmentVersionId: string;
  let orgAttemptId: string;

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

    // Attempt/answer fixture on the ORG-scoped assessment — attempts_select/
    // answers_select predate Session 21 entirely (assessment_core) and were
    // NOT touched by its migration; their teacher branches join directly to
    // "cohorts"/"cohort_teachers" (not through a SECURITY DEFINER helper),
    // so per Postgres's own "a referenced table's RLS policy is re-applied
    // under the querying session" behavior they SHOULD cascade correctly
    // from cohorts_select's Session 21 fix — this is exactly the same
    // "should cascade" assumption that turned out false for users_select's
    // SECURITY-DEFINER-backed branches above, so it is verified here rather
    // than trusted.
    const orgAssessmentVersion = await setup.assessmentVersion.create({
      data: {
        assessmentId: orgAssessmentId,
        version: 1,
        title: "Org Assessment v1",
        instructions: "",
        questions: [],
        publishedBy: admin.id,
      },
      select: { id: true },
    });
    orgAssessmentVersionId = orgAssessmentVersion.id;

    const orgAttempt = await setup.attempt.create({
      data: {
        assessmentId: orgAssessmentId,
        assessmentVersionId: orgAssessmentVersionId,
        courseId: orgCourseId,
        studentUserId: memberStudent.id,
        attemptNumber: 1,
      },
      select: { id: true },
    });
    orgAttemptId = orgAttempt.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.answer.deleteMany({ where: { attemptId: orgAttemptId } });
    await setup.attempt.deleteMany({ where: { id: orgAttemptId } });
    await setup.assessmentVersion.deleteMany({ where: { id: orgAssessmentVersionId } });
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

    it("SESSION 29 ADVERSARIAL — POSITIVE CONTROL: users_select's cohort-relationship branch, teacher-sees-student direction, correctly respects the org boundary (enrollments_select cascades through)", async () => {
      const outsiderTeacherSeesStudent = await asContext(
        { userId: outsiderTeacher.id, organizationIds: [orgBId] },
        (tx) => tx.user.findMany({ where: { id: memberStudent.id } })
      );
      expect(outsiderTeacherSeesStudent).toHaveLength(0);

      const memberTeacherSeesStudent = await asContext(
        { userId: memberTeacher.id, organizationIds: [orgAId] },
        (tx) => tx.user.findMany({ where: { id: memberStudent.id } })
      );
      expect(memberTeacherSeesStudent).toHaveLength(1);
    });

    it("SESSION 29 ADVERSARIAL — FINDING #1 (P1, confirmed): users_select's student-sees-teacher branch leaks an org-scoped cohort's teacher identity to a student who is NOT a member of that organization", async () => {
      // outsiderStudent holds a real (raw-inserted) enrollments row on
      // orgCohortId (Org A) but is only an active member of Org B — the
      // exact same fixture shape that correctly hides courses/cohorts/
      // enrollments/assessments/questions from this same actor above. The
      // "student sees teacher" branch of users_select instead uses
      // app_current_user_enrolled_cohort_ids() — a SECURITY DEFINER helper
      // that returns the caller's OWN enrollment cohort_ids with NO
      // organization check at all (unlike enrollments_select's teacher
      // branch, which explicitly re-checks app_cohort_organization_id()).
      // Real-world trigger: any student enrolled in an org-scoped cohort
      // whose OrganizationMembership later becomes non-active (left/
      // removed/suspended) — enrollment rows are not cleaned up on
      // membership changes (an already-documented gap) — permanently
      // retains this leak going forward, not just in this bypassed-fixture
      // scenario.
      const outsiderStudentSeesTeacher = await asContext(
        { userId: outsiderStudent.id, organizationIds: [orgBId] },
        (tx) => tx.user.findMany({ where: { id: memberTeacher.id } })
      );
      expect(outsiderStudentSeesTeacher).toHaveLength(0);
    });

    it("SESSION 29 ADVERSARIAL — FINDING #2 (P1, confirmed): users_select's student-sees-classmate branch leaks a fellow org-scoped classmate's identity to a student who is NOT a member of that organization", async () => {
      // Same root cause as Finding #1 — the classmate branch also drives
      // through app_current_user_enrolled_cohort_ids() with no org check.
      const outsiderStudentSeesClassmate = await asContext(
        { userId: outsiderStudent.id, organizationIds: [orgBId] },
        (tx) => tx.user.findMany({ where: { id: memberStudent.id } })
      );
      expect(outsiderStudentSeesClassmate).toHaveLength(0);
    });

    it("SESSION 29 ADVERSARIAL — VERIFIED, no bug: attempts_select's teacher branch (assessment_core, predates Session 21) correctly cascades the org boundary via a direct join to cohorts, unlike users_select's SECURITY-DEFINER-backed branches above", async () => {
      const outsiderRows = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgBId] }, (tx) =>
        tx.attempt.findMany({ where: { id: orgAttemptId } })
      );
      expect(outsiderRows).toHaveLength(0);

      const memberRows = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.attempt.findMany({ where: { id: orgAttemptId } })
      );
      expect(memberRows).toHaveLength(1);
    });
  });

  // --- Session 45 (Outstanding Fixes & Consolidation) -------------------
  //
  // courses_write/courses_select's new courses.create.organization branches
  // (20260905120000_teacher_org_scoped_course_creation), proven by Postgres
  // itself under the real non-superuser role — independently of
  // src/lib/courses.ts's assertMayCreateCourse(), which is proven separately
  // in organization-aware-education.test.ts. Every case below sets
  // app.permissions/app.organization_ids by hand, i.e. it simulates a
  // crafted request that reached the database WITHOUT going through the
  // application-layer gate at all (CLAUDE_BUILD_RULES.md §5: "a user must
  // not gain access merely because a UI route is hidden").
  describe("Session 45: courses.create.organization is creation-only, and only inside the caller's own organizations", () => {
    // Courses these tests insert directly (bypassing src/lib/courses.ts) are
    // not tracked by the outer afterAll's fixed id list, so they're
    // collected and removed here — courses.organization_id is ON DELETE NO
    // ACTION, so leaving one behind breaks the outer organization cleanup.
    const s45CourseIds: string[] = [];

    afterAll(async () => {
      if (s45CourseIds.length === 0) return;
      const cleanup = new PrismaClient();
      await cleanup.course.deleteMany({ where: { id: { in: s45CourseIds } } });
      await cleanup.$disconnect();
    });

    const insertCourse = async (
      ctx: { userId: string; permissions: string[]; organizationIds?: string[] },
      row: { scope: "platform" | "organization"; organizationId: string | null }
    ) => {
      const inserted = await asContext(ctx, (tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO courses (title, description, status, scope, organization_id, created_by)
           VALUES ($1, '', 'draft', $2::"CourseScope", $3::uuid, $4::uuid) RETURNING id`,
          `S45 RLS ${randomUUID()}`,
          row.scope,
          row.organizationId,
          ctx.userId
        )
      );
      s45CourseIds.push(...inserted.map((r) => r.id));
      return inserted.length;
    };

    it("ALLOWS an organization-scoped INSERT for an organization in the caller's own app.organization_ids", async () => {
      await expect(
        insertCourse(
          { userId: memberTeacher.id, permissions: ["courses.create.organization"], organizationIds: [orgAId] },
          { scope: "organization", organizationId: orgAId }
        )
      ).resolves.toBe(1);
    });

    it("REFUSES a PLATFORM-scoped INSERT — courses.create.organization can never create a platform-wide course", async () => {
      await expect(
        insertCourse(
          { userId: memberTeacher.id, permissions: ["courses.create.organization"], organizationIds: [orgAId] },
          { scope: "platform", organizationId: null }
        )
      ).rejects.toThrow(/row-level security/i);
    });

    it("REFUSES an INSERT scoped to an organization the caller is not a member of, even with a forged organization id in the row", async () => {
      await expect(
        insertCourse(
          { userId: memberTeacher.id, permissions: ["courses.create.organization"], organizationIds: [orgAId] },
          { scope: "organization", organizationId: orgBId }
        )
      ).rejects.toThrow(/row-level security/i);
    });

    it("REFUSES an INSERT from a caller holding the key but NO active membership at all (empty app.organization_ids)", async () => {
      await expect(
        insertCourse(
          { userId: outsiderTeacher.id, permissions: ["courses.create.organization"], organizationIds: [] },
          { scope: "organization", organizationId: orgAId }
        )
      ).rejects.toThrow(/row-level security/i);
    });

    it("the key grants NO extra visibility: holding courses.create.organization does not make another organization's course selectable", async () => {
      const rows = await asContext(
        { userId: outsiderTeacher.id, permissions: ["courses.create.organization"], organizationIds: [orgBId] },
        (tx) => tx.course.findMany({ where: { id: orgCourseId } })
      );
      expect(rows).toHaveLength(0);
    });

    it("courses_select's new created_by branch is org-guarded: the creator sees their own course while a member, and stops seeing it once they are no longer one", async () => {
      const created = await asContext(
        { userId: memberTeacher.id, permissions: ["courses.create.organization"], organizationIds: [orgAId] },
        (tx) =>
          tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO courses (title, description, status, scope, organization_id, created_by)
             VALUES ($1, '', 'draft', 'organization', $2::uuid, $3::uuid) RETURNING id`,
            `S45 Creator Visibility ${randomUUID()}`,
            orgAId,
            memberTeacher.id
          )
      );
      s45CourseIds.push(...created.map((r) => r.id));
      // INSERT ... RETURNING is itself subject to courses_select — this
      // returning a row IS the proof the created_by branch works, and is
      // exactly why the migration had to touch courses_select at all.
      expect(created).toHaveLength(1);
      const courseId = created[0].id;

      const asMember = await asContext({ userId: memberTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.course.findMany({ where: { id: courseId } })
      );
      expect(asMember).toHaveLength(1);

      // Same creator, no longer carrying that organization — the same
      // narrowing the teacher-of-cohort branch already applies.
      const asFormerMember = await asContext({ userId: memberTeacher.id, organizationIds: [] }, (tx) =>
        tx.course.findMany({ where: { id: courseId } })
      );
      expect(asFormerMember).toHaveLength(0);

      // And never to anyone else.
      const asOutsider = await asContext({ userId: outsiderTeacher.id, organizationIds: [orgAId] }, (tx) =>
        tx.course.findMany({ where: { id: courseId } })
      );
      expect(asOutsider).toHaveLength(0);
    });
  });
});
