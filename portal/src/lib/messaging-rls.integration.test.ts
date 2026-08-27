import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the messaging_core + messaging_cohort_visibility migrations' RLS
 * policies are enforced by Postgres itself, against the real non-superuser
 * portal_rls_test role — see src/lib/rls.integration.test.ts's header
 * comment for why this matters. This suite is what actually verified the
 * self-recursion fix (app_current_user_conversation_ids()/
 * app_current_user_enrolled_cohort_ids(), both SECURITY DEFINER) never hits
 * "infinite recursion detected in policy," same failure class documented in
 * the assessment_core/assets_files migrations.
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Messaging Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean; permissions?: string[] },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      return fn(tx);
    });
  }

  let teacher: { id: string };
  let s1: { id: string };
  let s2: { id: string };
  let outsiderStudent: { id: string };
  let courseId: string;
  let cohortId: string;
  let otherCohortId: string;
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    const mk = (label: string) =>
      setup.user.create({
        data: { email: `msg-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    teacher = await mk("teacher");
    s1 = await mk("s1");
    s2 = await mk("s2");
    outsiderStudent = await mk("outsider");

    const course = await setup.course.create({ data: { title: "Msg RLS Course", createdBy: teacher.id }, select: { id: true } });
    courseId = course.id;
    const cohort = await setup.cohort.create({ data: { courseId, name: "Cohort A" }, select: { id: true } });
    cohortId = cohort.id;
    const otherCohort = await setup.cohort.create({ data: { courseId, name: "Cohort B" }, select: { id: true } });
    otherCohortId = otherCohort.id;

    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: s1.id, status: "active" } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: s2.id, status: "active" } });
    // outsiderStudent has no enrollment anywhere.

    const conversation = await setup.conversation.create({ data: { type: "direct", createdBy: s1.id }, select: { id: true } });
    conversationId = conversation.id;
    await setup.conversationParticipant.createMany({
      data: [
        { conversationId, userId: s1.id },
        { conversationId, userId: teacher.id },
      ],
    });
    const message = await setup.message.create({
      data: { conversationId, senderId: s1.id, body: "hello" },
      select: { id: true },
    });
    messageId = message.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.assetAttachment.deleteMany({ where: { entityType: "message", entityId: messageId } });
    await setup.message.deleteMany({ where: { conversationId } });
    await setup.conversationParticipant.deleteMany({ where: { conversationId } });
    await setup.conversation.deleteMany({ where: { id: conversationId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({ where: { id: { in: [teacher.id, s1.id, s2.id, outsiderStudent.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  describe("conversations / conversation_participants / messages", () => {
    it("a participant sees the conversation, its participant rows, and its messages", async () => {
      const [conv, participants, messages] = await asContext({ userId: teacher.id }, (tx) =>
        Promise.all([
          tx.conversation.findMany({ where: { id: conversationId } }),
          tx.conversationParticipant.findMany({ where: { conversationId } }),
          tx.message.findMany({ where: { conversationId } }),
        ])
      );
      expect(conv).toHaveLength(1);
      expect(participants).toHaveLength(2);
      expect(messages).toHaveLength(1);
    });

    it("a non-participant sees nothing at all — not the conversation, not participant rows, not messages", async () => {
      const [conv, participants, messages] = await asContext({ userId: outsiderStudent.id }, (tx) =>
        Promise.all([
          tx.conversation.findMany({ where: { id: conversationId } }),
          tx.conversationParticipant.findMany({ where: { conversationId } }),
          tx.message.findMany({ where: { conversationId } }),
        ])
      );
      expect(conv).toHaveLength(0);
      expect(participants).toHaveLength(0);
      expect(messages).toHaveLength(0);
    });

    it("messages_write: a non-participant cannot INSERT a message into a conversation they're not part of", async () => {
      await expect(
        asContext({ userId: outsiderStudent.id }, (tx) =>
          tx.message.create({ data: { conversationId, senderId: outsiderStudent.id, body: "sneaky" } })
        )
      ).rejects.toThrow();
    });

    it("messages_write: a real participant CAN insert a message, as themselves", async () => {
      const created = await asContext({ userId: teacher.id }, (tx) =>
        tx.message.create({ data: { conversationId, senderId: teacher.id, body: "reply" } })
      );
      expect(created.conversationId).toBe(conversationId);
      const setup = new PrismaClient();
      await setup.message.delete({ where: { id: created.id } });
      await setup.$disconnect();
    });

    it("messages_write: a participant cannot forge sender_id as someone else", async () => {
      await expect(
        asContext({ userId: teacher.id }, (tx) =>
          tx.message.create({ data: { conversationId, senderId: s1.id, body: "spoofed" } })
        )
      ).rejects.toThrow();
    });

    it("conversation_participants_write: only the conversation's creator may insert a participant row", async () => {
      await expect(
        asContext({ userId: teacher.id }, (tx) =>
          tx.conversationParticipant.create({ data: { conversationId, userId: outsiderStudent.id } })
        )
      ).rejects.toThrow();
    });

    it("no recursion: messages_select for a large batch resolves without 'infinite recursion detected in policy'", async () => {
      // A regression guard for the specific bug class this migration's own
      // header comment documents — if the SECURITY DEFINER indirection were
      // ever replaced with a naive self-referencing subquery, this query
      // would fail with Postgres error 42P17, not just return wrong rows.
      await expect(
        asContext({ userId: s2.id }, (tx) => tx.conversation.findMany())
      ).resolves.toBeDefined();
    });
  });

  describe("messaging_cohort_visibility (cohort_teachers/enrollments widening)", () => {
    it("cohort_teachers_select: an enrolled student can see who teaches their own cohort", async () => {
      const rows = await asContext({ userId: s1.id }, (tx) => tx.cohortTeacher.findMany({ where: { cohortId } }));
      expect(rows.map((r) => r.teacherUserId)).toEqual([teacher.id]);
    });

    it("cohort_teachers_select: a student NOT enrolled in that cohort sees nothing", async () => {
      const rows = await asContext({ userId: outsiderStudent.id }, (tx) => tx.cohortTeacher.findMany({ where: { cohortId } }));
      expect(rows).toHaveLength(0);
    });

    it("cohort_teachers_select: an enrolled student sees nothing for a DIFFERENT cohort of the same course they're not in", async () => {
      const setup = new PrismaClient();
      await setup.cohortTeacher.create({ data: { cohortId: otherCohortId, teacherUserId: teacher.id } });
      await setup.$disconnect();

      const rows = await asContext({ userId: s1.id }, (tx) => tx.cohortTeacher.findMany({ where: { cohortId: otherCohortId } }));
      expect(rows).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.cohortTeacher.deleteMany({ where: { cohortId: otherCohortId } });
      await cleanup.$disconnect();
    });

    it("enrollments_select: a student can see a classmate's enrollment row in a shared cohort", async () => {
      const rows = await asContext({ userId: s1.id }, (tx) =>
        tx.enrollment.findMany({ where: { cohortId, studentUserId: s2.id } })
      );
      expect(rows).toHaveLength(1);
    });

    it("enrollments_select: a student outside the cohort cannot see either student's enrollment", async () => {
      const rows = await asContext({ userId: outsiderStudent.id }, (tx) =>
        tx.enrollment.findMany({ where: { cohortId, studentUserId: { in: [s1.id, s2.id] } } })
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("asset_attachments for entity_type = 'message'", () => {
    let assetId: string;

    beforeAll(async () => {
      const setup = new PrismaClient();
      const asset = await setup.asset.create({
        data: {
          uploaderId: s1.id,
          originalFilename: "note.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
          storageDriver: "local",
          storageKey: randomUUID(),
          checksumSha256: "x".repeat(64),
        },
        select: { id: true },
      });
      assetId = asset.id;
      await setup.$disconnect();
    });

    afterAll(async () => {
      const setup = new PrismaClient();
      await setup.assetAttachment.deleteMany({ where: { assetId } });
      await setup.asset.deleteMany({ where: { id: assetId } });
      await setup.$disconnect();
    });

    it("asset_attachments_write: the message's own sender can attach an asset to it", async () => {
      const created = await asContext({ userId: s1.id }, (tx) =>
        tx.assetAttachment.create({ data: { assetId, entityType: "message", entityId: messageId, attachedBy: s1.id } })
      );
      expect(created.entityId).toBe(messageId);
    });

    it("asset_attachments_select: a conversation participant can see the attachment; a non-participant cannot", async () => {
      const visible = await asContext({ userId: teacher.id }, (tx) =>
        tx.assetAttachment.findMany({ where: { entityType: "message", entityId: messageId } })
      );
      expect(visible).toHaveLength(1);

      const hidden = await asContext({ userId: outsiderStudent.id }, (tx) =>
        tx.assetAttachment.findMany({ where: { entityType: "message", entityId: messageId } })
      );
      expect(hidden).toHaveLength(0);
    });

    it("asset_attachments_write: someone who is NOT the message's sender cannot attach an asset to it", async () => {
      const setup = new PrismaClient();
      const otherAsset = await setup.asset.create({
        data: {
          uploaderId: teacher.id,
          originalFilename: "other.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
          storageDriver: "local",
          storageKey: randomUUID(),
          checksumSha256: "y".repeat(64),
        },
        select: { id: true },
      });
      await setup.$disconnect();

      await expect(
        asContext({ userId: teacher.id }, (tx) =>
          tx.assetAttachment.create({ data: { assetId: otherAsset.id, entityType: "message", entityId: messageId, attachedBy: teacher.id } })
        )
      ).rejects.toThrow();

      const cleanup = new PrismaClient();
      await cleanup.asset.deleteMany({ where: { id: otherAsset.id } });
      await cleanup.$disconnect();
    });
  });
});
