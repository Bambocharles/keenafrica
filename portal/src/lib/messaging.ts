import { withRls } from "@/lib/rls";
import {
  AuthorizationError,
  PERMISSIONS,
  hasPermission,
  requirePermission,
  type AuthzActor,
} from "@/lib/authz";
import { actorRlsCtx } from "@/lib/courses";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { uploadAsset, deleteAssetIfOrphanedAsContentOwner } from "@/lib/assets";

/**
 * Messaging (Session 09) — the ONE canonical Conversation/Message system
 * for the whole platform (PLATFORM_CONTEXT.md's "Shared communication
 * rule"). Teacher/Student/Admin portals all consume this module directly;
 * none of them owns a parallel message table (CLAUDE_BUILD_RULES.md §3).
 *
 * Server-side participant authorization is enforced at two independent
 * layers, same defense-in-depth shape as every other content-visibility
 * rule in this codebase: application code below (findFirst scoped by
 * participant membership) AND the messaging_core migration's RLS policies
 * (see that migration's own header comment on the self-recursion fix).
 *
 * WHO may start a conversation with whom (assertCanMessage) is separate
 * from "can this participant post in a conversation they're already in"
 * (sendMessage) — the former is real relationship logic (a shared cohort,
 * via Session 04's canonical CohortTeacher/Enrollment tables, widened for
 * student visibility by the messaging_cohort_visibility migration), the
 * latter is pure participant-membership. See docs/MESSAGING.md.
 */

export type ConversationTypeValue = "direct" | "group" | "cohort_broadcast";

const ACTIVE_ENROLLMENT_STATUSES = ["active", "completed"] as const;

// --- Relationship / eligibility -------------------------------------------

/**
 * Symmetric "do these two users share a teaching/learning relationship"
 * check: A teaches a cohort B is (actively/recently) enrolled in, OR B
 * teaches a cohort A is enrolled in, OR A and B are both enrolled in the
 * same cohort. Runs entirely under the ACTING user's own RLS context —
 * the messaging_cohort_visibility migration widened cohort_teachers_select/
 * enrollments_select specifically so a plain STUDENT can see their own
 * cohort's teacher and fellow cohort-mates, so no elevated/system bypass is
 * needed here (contrast with e.g. sessions.ts's revokeAllUserSessionsAsSystem,
 * which genuinely needs one). If actor isn't actually a participant in any
 * of the relevant cohorts, RLS returns zero rows regardless of what the
 * WHERE clause asks for, so this fails closed correctly either way.
 */
async function haveSharedCohortRelationship(actor: AuthzActor, otherUserId: string): Promise<boolean> {
  if (actor.id === otherUserId) return false;

  const [actorTeachesForOther, otherTeachesForActor, sharedEnrollment] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.cohortTeacher.findFirst({
        where: {
          teacherUserId: actor.id,
          cohort: { enrollments: { some: { studentUserId: otherUserId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } } } },
        },
        select: { cohortId: true },
      }),
      tx.cohortTeacher.findFirst({
        where: {
          teacherUserId: otherUserId,
          cohort: { enrollments: { some: { studentUserId: actor.id, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } } } },
        },
        select: { cohortId: true },
      }),
      tx.enrollment.findFirst({
        where: {
          studentUserId: actor.id,
          status: { in: [...ACTIVE_ENROLLMENT_STATUSES] },
          cohort: { enrollments: { some: { studentUserId: otherUserId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } } } },
        },
        select: { id: true },
      }),
    ])
  );

  return !!(actorTeachesForOther || otherTeachesForActor || sharedEnrollment);
}

/**
 * Throws AuthorizationError unless actor may start a direct/group
 * conversation with targetUserId. messages.admin (ADMIN/SUPER_ADMIN)
 * bypasses the relationship check entirely — "Admin -> permitted users"
 * (sessions/09-messaging.md's required use case list). Everyone else needs
 * messages.send (TEACHER/STUDENT, by default) AND a real relationship.
 */
export async function assertCanMessage(actor: AuthzActor, targetUserId: string): Promise<void> {
  if (targetUserId === actor.id) throw new AuthorizationError("Cannot message yourself");

  const targetExists = await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
  );
  if (!targetExists) throw new AuthorizationError("Recipient not found");

  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.MESSAGES_ADMIN)) return;

  requirePermission(actor, PERMISSIONS.MESSAGES_SEND);
  if (!(await haveSharedCohortRelationship(actor, targetUserId))) {
    throw new AuthorizationError("No permitted relationship with this recipient");
  }
}

/** True when actor holds a cohort_teachers row for this specific cohort. */
async function isCohortTeacher(cohortId: string, actor: AuthzActor): Promise<boolean> {
  const count = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohortTeacher.count({ where: { teacherUserId: actor.id, cohortId } })
  );
  return count > 0;
}

/** A teacher's own cohorts, for the "broadcast to a cohort" compose picker. */
export async function listMyBroadcastCohorts(actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.cohortTeacher.findMany({
      where: { teacherUserId: actor.id },
      include: { cohort: { include: { course: { select: { id: true, title: true } } } } },
      orderBy: { cohort: { name: "asc" } },
    })
  );
}

/** A teacher's own students (deduped across every cohort they teach), for the "message a student" compose picker. */
export async function listMessageableStudentsForTeacher(actor: AuthzActor) {
  const enrollments = await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findMany({
      where: { status: { in: [...ACTIVE_ENROLLMENT_STATUSES] }, cohort: { teachers: { some: { teacherUserId: actor.id } } } },
      include: { student: { select: { id: true, name: true, email: true } }, cohort: { select: { id: true, name: true } } },
      orderBy: { student: { name: "asc" } },
    })
  );
  const byStudent = new Map<string, { id: string; name: string; email: string; cohorts: { id: string; name: string }[] }>();
  for (const e of enrollments) {
    const existing = byStudent.get(e.student.id);
    if (existing) existing.cohorts.push(e.cohort);
    else byStudent.set(e.student.id, { ...e.student, cohorts: [e.cohort] });
  }
  return [...byStudent.values()];
}

/** A student's own teachers + fellow cohort-mates, for the "message a teacher/classmate" compose picker. */
export async function listMessageableForStudent(actor: AuthzActor) {
  const myEnrollments = await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findMany({
      where: { studentUserId: actor.id, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
      select: { cohortId: true, cohort: { select: { name: true } } },
    })
  );
  const cohortIds = myEnrollments.map((e) => e.cohortId);
  if (cohortIds.length === 0) return { teachers: [], classmates: [] };

  const [teacherRows, classmateRows] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.cohortTeacher.findMany({
        where: { cohortId: { in: cohortIds } },
        include: { teacher: { select: { id: true, name: true, email: true } }, cohort: { select: { id: true, name: true } } },
      }),
      tx.enrollment.findMany({
        where: { cohortId: { in: cohortIds }, studentUserId: { not: actor.id }, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
        include: { student: { select: { id: true, name: true, email: true } }, cohort: { select: { id: true, name: true } } },
      }),
    ])
  );

  const teachers = new Map<string, { id: string; name: string; email: string; cohorts: { id: string; name: string }[] }>();
  for (const row of teacherRows) {
    const existing = teachers.get(row.teacher.id);
    if (existing) existing.cohorts.push(row.cohort);
    else teachers.set(row.teacher.id, { ...row.teacher, cohorts: [row.cohort] });
  }
  const classmates = new Map<string, { id: string; name: string; email: string; cohorts: { id: string; name: string }[] }>();
  for (const row of classmateRows) {
    const existing = classmates.get(row.student.id);
    if (existing) existing.cohorts.push(row.cohort);
    else classmates.set(row.student.id, { ...row.student, cohorts: [row.cohort] });
  }
  return { teachers: [...teachers.values()], classmates: [...classmates.values()] };
}

// --- Conversation / Message -------------------------------------------------

export interface StartConversationInput {
  type: ConversationTypeValue;
  /** direct: exactly one id. group: two or more. Ignored for cohort_broadcast. */
  participantIds?: string[];
  /** Required for cohort_broadcast; ignored otherwise. */
  cohortId?: string;
  body: string;
  attachment?: { originalFilename: string; declaredMimeType: string; buffer: Buffer };
}

/**
 * Creates a conversation with its fixed participant set and the first
 * message, in one transaction. Every participant is validated via
 * assertCanMessage() (or cohort-teaching ownership, for a broadcast)
 * BEFORE any row is written — never a partially-authorized conversation.
 */
export async function startConversation(input: StartConversationInput, actor: AuthzActor) {
  const body = input.body.trim();
  if (!body && !input.attachment) throw new Error("Message body or attachment is required");

  let participantIds: string[];
  let contextCohortId: string | null = null;

  if (input.type === "cohort_broadcast") {
    if (!input.cohortId) throw new Error("cohortId is required for a cohort broadcast");
    if (!(actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.MESSAGES_ADMIN))) {
      requirePermission(actor, PERMISSIONS.MESSAGES_SEND);
      if (!(await isCohortTeacher(input.cohortId, actor))) {
        throw new AuthorizationError("Not assigned to teach this cohort");
      }
    }
    const enrollments = await withRls(actorRlsCtx(actor), (tx) =>
      tx.enrollment.findMany({
        where: { cohortId: input.cohortId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
        select: { studentUserId: true },
      })
    );
    participantIds = enrollments.map((e) => e.studentUserId);
    if (participantIds.length === 0) throw new Error("This cohort has no active students to broadcast to");
    contextCohortId = input.cohortId;
  } else {
    const targets = [...new Set((input.participantIds ?? []).filter((id) => id !== actor.id))];
    if (input.type === "direct" && targets.length !== 1) {
      throw new Error("A direct conversation needs exactly one recipient");
    }
    if (input.type === "group" && targets.length < 2) {
      throw new Error("A group conversation needs at least two recipients");
    }
    for (const targetId of targets) {
      await assertCanMessage(actor, targetId);
    }
    participantIds = targets;
  }

  let asset: Awaited<ReturnType<typeof uploadAsset>> | null = null;
  if (input.attachment) {
    asset = await uploadAsset(input.attachment, actor);
  }

  try {
    const result = await withRls(actorRlsCtx(actor), async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          type: input.type,
          contextCohortId,
          createdBy: actor.id,
          lastMessageAt: new Date(),
        },
      });
      await tx.conversationParticipant.createMany({
        data: [actor.id, ...participantIds].map((userId) => ({
          conversationId: conversation.id,
          userId,
          lastReadAt: userId === actor.id ? new Date() : null,
        })),
      });
      const message = await tx.message.create({
        data: { conversationId: conversation.id, senderId: actor.id, body },
      });
      if (asset) {
        await tx.assetAttachment.create({
          data: { assetId: asset.id, entityType: "message", entityId: message.id, attachedBy: actor.id },
        });
      }
      return { conversation, message };
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "conversation.created",
      entityType: "Conversation",
      entityId: result.conversation.id,
      metadata: { type: input.type, participantCount: participantIds.length + 1 },
    });

    for (const recipientId of participantIds) {
      emitDomainEvent("MessageReceived", {
        messageId: result.message.id,
        conversationId: result.conversation.id,
        recipientId,
      });
    }

    return result;
  } catch (err) {
    if (asset) await deleteAssetIfOrphanedAsContentOwner(asset.id, actor).catch(() => {});
    throw err;
  }
}

/** Throws AuthorizationError unless actor is a participant of conversationId. */
async function requireParticipant(conversationId: string, actor: AuthzActor): Promise<void> {
  if (actor.isSuperAdmin) return;
  const membership = await withRls(actorRlsCtx(actor), (tx) =>
    tx.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      select: { userId: true },
    })
  );
  if (!membership) throw new AuthorizationError("Not a participant in this conversation");
}

export interface SendMessageInput {
  body: string;
  attachment?: { originalFilename: string; declaredMimeType: string; buffer: Buffer };
}

/** Posts a message into an EXISTING conversation. Requires actor already be a participant. */
export async function sendMessage(conversationId: string, input: SendMessageInput, actor: AuthzActor) {
  await requireParticipant(conversationId, actor);

  const body = input.body.trim();
  if (!body && !input.attachment) throw new Error("Message body or attachment is required");

  let asset: Awaited<ReturnType<typeof uploadAsset>> | null = null;
  if (input.attachment) {
    asset = await uploadAsset(input.attachment, actor);
  }

  try {
    const message = await withRls(actorRlsCtx(actor), async (tx) => {
      const created = await tx.message.create({ data: { conversationId, senderId: actor.id, body } });
      if (asset) {
        await tx.assetAttachment.create({
          data: { assetId: asset.id, entityType: "message", entityId: created.id, attachedBy: actor.id },
        });
      }
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.sentAt } });
      // Sending also marks the sender's own copy read up to this point —
      // otherwise a prolific sender would see their own conversation as
      // perpetually unread.
      await tx.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId: actor.id } },
        data: { lastReadAt: created.sentAt },
      });
      return created;
    });

    const otherParticipants = await withRls(actorRlsCtx(actor), (tx) =>
      tx.conversationParticipant.findMany({
        where: { conversationId, userId: { not: actor.id } },
        select: { userId: true },
      })
    );
    for (const p of otherParticipants) {
      emitDomainEvent("MessageReceived", { messageId: message.id, conversationId, recipientId: p.userId });
    }

    return message;
  } catch (err) {
    if (asset) await deleteAssetIfOrphanedAsContentOwner(asset.id, actor).catch(() => {});
    throw err;
  }
}

/** Marks a conversation read up to now for actor. Requires participant membership. */
export async function markConversationRead(conversationId: string, actor: AuthzActor) {
  await requireParticipant(conversationId, actor);
  await withRls(actorRlsCtx(actor), (tx) =>
    tx.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      data: { lastReadAt: new Date() },
    })
  );
}

export interface ConversationSummary {
  id: string;
  type: ConversationTypeValue;
  contextCohortId: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  participants: { userId: string; name: string; email: string }[];
  lastMessage: { id: string; senderId: string; senderName: string; body: string; sentAt: Date } | null;
  unreadCount: number;
}

/** actor's own inbox — every conversation they participate in, most-recent first. */
export async function listMyConversations(actor: AuthzActor): Promise<ConversationSummary[]> {
  const memberships = await withRls(actorRlsCtx(actor), (tx) =>
    tx.conversationParticipant.findMany({
      where: { userId: actor.id },
      select: { conversationId: true, lastReadAt: true },
    })
  );
  if (memberships.length === 0) return [];
  const lastReadByConversation = new Map(memberships.map((m) => [m.conversationId, m.lastReadAt]));
  const conversationIds = memberships.map((m) => m.conversationId);

  const conversations = await withRls(actorRlsCtx(actor), (tx) =>
    tx.conversation.findMany({
      where: { id: { in: conversationIds } },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      include: {
        participants: { include: { user: { select: { id: true, name: true, email: true } } } },
        messages: { orderBy: { sentAt: "desc" }, take: 1, include: { sender: { select: { name: true } } } },
      },
    })
  );

  const unreadCounts = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all(
      conversationIds.map((id) =>
        tx.message.count({
          where: {
            conversationId: id,
            senderId: { not: actor.id },
            sentAt: { gt: lastReadByConversation.get(id) ?? new Date(0) },
          },
        })
      )
    )
  );
  const unreadById = new Map(conversationIds.map((id, i) => [id, unreadCounts[i]]));

  return conversations.map((c) => {
    const last = c.messages[0];
    return {
      id: c.id,
      type: c.type,
      contextCohortId: c.contextCohortId,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
      participants: c.participants.map((p) => ({ userId: p.user.id, name: p.user.name, email: p.user.email })),
      lastMessage: last ? { id: last.id, senderId: last.senderId, senderName: last.sender.name, body: last.body, sentAt: last.sentAt } : null,
      unreadCount: unreadById.get(c.id) ?? 0,
    };
  });
}

export interface MessageSummary {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  sentAt: Date;
  attachment: { assetId: string; filename: string } | null;
}

/** A single conversation's full message thread, oldest first. Requires participant membership. */
export async function getConversationThread(conversationId: string, actor: AuthzActor) {
  await requireParticipant(conversationId, actor);

  const conversation = await withRls(actorRlsCtx(actor), (tx) =>
    tx.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { include: { user: { select: { id: true, name: true, email: true } } } } },
    })
  );
  if (!conversation) throw new Error("Conversation not found");

  const messages = await withRls(actorRlsCtx(actor), (tx) =>
    tx.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: "asc" },
      include: { sender: { select: { name: true } } },
    })
  );

  const messageIds = messages.map((m) => m.id);
  const attachments =
    messageIds.length === 0
      ? []
      : await withRls(actorRlsCtx(actor), (tx) =>
          tx.assetAttachment.findMany({
            where: { entityType: "message", entityId: { in: messageIds } },
            include: { asset: { select: { id: true, originalFilename: true } } },
          })
        );
  const attachmentByMessageId = new Map(attachments.map((a) => [a.entityId, a.asset]));

  const summaries: MessageSummary[] = messages.map((m) => {
    const asset = attachmentByMessageId.get(m.id);
    return {
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender.name,
      body: m.body,
      sentAt: m.sentAt,
      attachment: asset ? { assetId: asset.id, filename: asset.originalFilename } : null,
    };
  });

  return {
    conversation: {
      id: conversation.id,
      type: conversation.type,
      contextCohortId: conversation.contextCohortId,
      participants: conversation.participants.map((p) => ({ userId: p.user.id, name: p.user.name, email: p.user.email })),
    },
    messages: summaries,
  };
}
