import { Prisma } from "@prisma/client";
import { withRls } from "@/lib/rls";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { onDomainEvent } from "@/lib/events";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { sendMail } from "@/lib/mailer";

/**
 * Notifications (Session 10) — the ONE canonical notification center for
 * the whole platform (PLATFORM_CONTEXT.md's "Shared communication rule";
 * PLATFORM_ARCHITECTURE.md lists "notifications" as a Platform Core service
 * alongside messaging). No portal owns a parallel notification table
 * (CLAUDE_BUILD_RULES.md §3) — Teacher/Student/Admin all read/mark-read
 * through this module over the single `notifications` table.
 *
 * Ownership boundary: this module NEVER decides that something happened —
 * that is entirely the owning module's job (Messaging decides a message was
 * sent, Assessment decides an attempt was graded, ...). This module only
 * decides HOW to tell a user about it, exclusively by subscribing to
 * src/lib/events.ts's existing DomainEventMap. createNotification() is
 * therefore NOT a caller-facing API for other modules to call directly (see
 * its own docstring) — the only sanctioned way to make a notification
 * appear is to emit (or already have emitted) a domain event. This keeps a
 * clean separation and means a future session never has to learn a second
 * "notify someone" mechanism.
 *
 * Duplicate-delivery protection (explicit acceptance criterion): every
 * listener below derives a `dedupeKey` from the driving event's own natural
 * identity — see each handler's comment for exactly what makes that key
 * unique per REAL occurrence (not just per event name). createNotification()
 * upserts against the notifications_recipient_id_dedupe_key_key unique
 * constraint, so redelivering the same occurrence (a re-registered
 * listener, an idempotent caller like courses.ts's enrollStudent — see its
 * own re-emit-on-already-enrolled behavior — or a future durable-queue
 * redelivery once events.ts's transport is swapped per its own docstring)
 * creates at most one row and triggers channel delivery at most once.
 *
 * Delivery channels: in-app (the row itself — always on, not flag-gated,
 * same "core plumbing" treatment as audit/progress) plus an explicit
 * NotificationChannel abstraction for anything beyond it. See the "Delivery
 * channels" section below and docs/NOTIFICATIONS.md.
 *
 * Preferences (Session 39): a generic per-user, per-NotificationType
 * opt-out, checked once inside createNotification() itself — see
 * NotificationPreference's schema comment and the "Preferences" section
 * below. Built here, generically, rather than as a Keen-Africans-specific
 * table, per this session's own "no parallel notification system" rule.
 */

export type NotificationTypeValue =
  | "message_received"
  | "assessment_assigned"
  | "assessment_submitted"
  | "assessment_graded"
  | "course_published"
  | "student_enrolled"
  | "certificate_issued"
  | "account_suspended"
  | "role_changed"
  | "project_milestone_updated"
  // Session 39 (Keen Africans — Notifications). See schema.prisma's
  // NotificationType comment and docs/NOTIFICATIONS.md's "Extension
  // points" for why this is the only value this session adds.
  | "article_unpublished_by_admin"
  // Session 40 (Keen Africans — LinkedIn Verification). The "verification
  // status" value Session 39's own docstring anticipated — see the
  // listener below and events.ts's VerificationStatusChanged comment.
  | "verification_status_changed"
  // Session 42 (Follow & Author Reputation Display). The "follow" value
  // Session 39's own docstring anticipated — see the listener below and
  // events.ts's UserFollowed comment.
  | "user_followed"
  // Session 45 (Outstanding Fixes & Consolidation). The review-workflow
  // values Session 39's own docstring anticipated — see the listeners
  // below and events.ts's ArticleApproved/ArticleChangesRequested/
  // ArticleRejected/ArticlePublished comments.
  | "article_approved"
  | "article_changes_requested"
  | "article_rejected"
  | "article_published";

const ACTIVE_ENROLLMENT_STATUSES = ["active", "completed"] as const;

/** System-level RLS context for recipient-resolution reads. See "Why notifications_write is unconditional" in the migration and docs/NOTIFICATIONS.md — an event listener has no acting user/request, so there is no per-request app.user_id to scope these reads to. isSuperAdmin is the platform's existing, documented RLS bypass (src/lib/rls.ts), not a new mechanism; it is used here ONLY inside this module's own internal listeners, never derived from end-user input. */
const SYSTEM_CTX = { isSuperAdmin: true } as const;

// --- Delivery channel abstraction -----------------------------------------

export interface NotificationDeliveryContext {
  recipientId: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
}

/**
 * A delivery channel beyond in-app. PLATFORM_ARCHITECTURE.md §12: incomplete
 * functionality is controlled by a feature flag rather than exposed
 * prematurely — every channel here MUST check its own flag before doing
 * anything, and a channel failure must never break notification creation
 * itself (in-app delivery — the DB row — always succeeds regardless of what
 * any channel below does; errors are caught and logged, same isolation
 * philosophy as events.ts's onDomainEvent wrapper).
 */
export interface NotificationChannel {
  key: string;
  isEnabled(): Promise<boolean>;
  deliver(ctx: NotificationDeliveryContext): Promise<void>;
}

/**
 * Real, functional today — backed by src/lib/mailer.ts's dev-stub
 * sendMail(). Gated behind FEATURE_FLAGS.NOTIFICATIONS_EMAIL (seeded off):
 * mailer.ts throws in production (no real transactional email provider
 * exists anywhere in this infra — Session 02's still-open blocker), so
 * this flag must stay off in production until that's resolved. This is the
 * literal "feature flags prevent incomplete channels from exposing broken
 * UX" acceptance criterion: with the flag off, email is a pure no-op, never
 * attempted, never surfaced as a broken/missing "you'll get an email" claim
 * anywhere in the UI.
 */
const emailChannel: NotificationChannel = {
  key: "email",
  isEnabled: () => isFeatureEnabled(FEATURE_FLAGS.NOTIFICATIONS_EMAIL),
  async deliver({ recipientId, title, body }) {
    const user = await withRls(SYSTEM_CTX, (tx) =>
      tx.user.findUnique({ where: { id: recipientId }, select: { email: true } })
    );
    if (!user) return;
    await sendMail({ to: user.email, subject: title, text: body });
  },
};

/**
 * Registered channels beyond in-app. Push/SMS/WhatsApp are deliberately
 * NOT registered here — unlike email there is no provider, no library, and
 * no dev-stub for any of them anywhere in this codebase (a genuinely
 * missing capability, not just an unflipped flag — CLAUDE_BUILD_RULES.md's
 * "no half-finished implementations"). FEATURE_FLAGS.NOTIFICATIONS_PUSH/
 * _SMS/_WHATSAPP are reserved keys only (seeded off), exactly the same
 * "pre-declared ahead of the owning session" pattern this repo already uses
 * for CERTIFICATES/SPONSOR_REPORTING/AI_TUTORING. Extending this for a real
 * provider: implement NotificationChannel, push it into this array, wire
 * its isEnabled() to the matching flag — no other change needed anywhere
 * else in this module.
 */
const CHANNELS: NotificationChannel[] = [emailChannel];

async function dispatchToChannels(ctx: NotificationDeliveryContext): Promise<void> {
  for (const channel of CHANNELS) {
    try {
      if (await channel.isEnabled()) {
        await channel.deliver(ctx);
      }
    } catch (err) {
      // A channel failure must never break in-app delivery (already
      // committed by the time this runs) or any other channel.
      console.error(`[notifications] channel "${channel.key}" delivery failed`, err);
    }
  }
}

// --- Preferences (Session 39) ----------------------------------------

/**
 * Generic per-user, per-type opt-out — Session 10's own brief listed
 * "notification preferences" but never built it; this is that capability,
 * built once here rather than forked per portal. See
 * NotificationPreference's schema comment for the "absence of a row means
 * enabled, this table only ever holds opt-outs" contract.
 */
async function isNotificationEnabled(userId: string, type: NotificationTypeValue): Promise<boolean> {
  const pref = await withRls(SYSTEM_CTX, (tx) =>
    tx.notificationPreference.findUnique({ where: { userId_type: { userId, type } }, select: { enabled: true } })
  );
  return pref?.enabled ?? true;
}

/** Self-scoped read for a settings UI toggle — RLS-backstopped identically to every other self-only read in this module. */
export async function getNotificationPreference(actor: AuthzActor, type: NotificationTypeValue): Promise<boolean> {
  const pref = await withRls(actorRlsCtxLocal(actor), (tx) =>
    tx.notificationPreference.findUnique({ where: { userId_type: { userId: actor.id, type } }, select: { enabled: true } })
  );
  return pref?.enabled ?? true;
}

/**
 * Self-scoped write. Re-enabling deletes the opt-out row entirely rather
 * than writing enabled=true, keeping this table's "only ever holds
 * opt-outs" invariant intact (see its schema comment) — an empty table is
 * therefore always "everyone gets everything," the same default this
 * platform had before this session.
 */
export async function setNotificationPreference(actor: AuthzActor, type: NotificationTypeValue, enabled: boolean): Promise<void> {
  if (enabled) {
    await withRls(actorRlsCtxLocal(actor), (tx) => tx.notificationPreference.deleteMany({ where: { userId: actor.id, type } }));
    return;
  }
  await withRls(actorRlsCtxLocal(actor), (tx) =>
    tx.notificationPreference.upsert({
      where: { userId_type: { userId: actor.id, type } },
      create: { userId: actor.id, type, enabled: false },
      update: { enabled: false },
    })
  );
}

// --- Core write path --------------------------------------------------

export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  /** See the module docstring's "Duplicate-delivery protection" section. Required — every call site must derive one from the driving event. */
  dedupeKey: string;
}

/**
 * NOT a caller-facing API — see the module docstring. Only this module's own
 * onDomainEvent listeners below call it. Exported solely so tests can
 * exercise the write/dedupe/channel-dispatch path directly without needing
 * to fabricate an entire upstream event flow for every case.
 *
 * Returns `{ created: boolean }` — false means an earlier call already
 * delivered this exact (recipientId, dedupeKey) occurrence, and channel
 * dispatch was correctly skipped.
 */
export async function createNotification(input: CreateNotificationInput): Promise<{ created: boolean }> {
  // Session 39 (Keen Africans — Notifications). Checked first, ahead of the
  // dedupe/write path below, so an opted-out recipient gets no row at all
  // (not a suppressed-but-recorded one) — see NotificationPreference's own
  // schema comment for why absence-of-row means enabled.
  if (!(await isNotificationEnabled(input.recipientId, input.type))) {
    return { created: false };
  }

  // Unlike audit.ts's recordAuditEvent(), this can use a plain typed
  // create() rather than a raw INSERT: that function's problem was that
  // Postgres enforces the SELECT policy on any INSERT ... RETURNING row,
  // and the ACTOR performing an audited action often lacks audit.read.
  // Here the write always runs under SYSTEM_CTX (is_super_admin=true),
  // which notifications_select's bypass branch satisfies unconditionally
  // regardless of recipient_id — so RETURNING never hits the policy at all.
  let created: boolean;
  try {
    await withRls(SYSTEM_CTX, (tx) =>
      tx.notification.create({
        data: {
          recipientId: input.recipientId,
          type: input.type,
          title: input.title,
          body: input.body,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          dedupeKey: input.dedupeKey,
        },
      })
    );
    created = true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Duplicate delivery of the same occurrence — already notified, and
      // (if it happened) already dispatched to channels. No-op.
      created = false;
    } else {
      throw err;
    }
  }

  if (created) {
    await dispatchToChannels({ recipientId: input.recipientId, type: input.type, title: input.title, body: input.body });
  }

  return { created };
}

// --- Event listeners: the event-to-notification mapping ------------------
// One listener per mapped domain event. See docs/NOTIFICATIONS.md for the
// full "which event produces which notification type, and for whom" table.

onDomainEvent("MessageReceived", async ({ messageId, conversationId, recipientId }) => {
  const message = await withRls(SYSTEM_CTX, (tx) =>
    tx.message.findUnique({ where: { id: messageId }, include: { sender: { select: { name: true } } } })
  );
  if (!message) return;
  const snippet = message.body.length > 140 ? `${message.body.slice(0, 140)}…` : message.body;
  await createNotification({
    recipientId,
    type: "message_received",
    title: `New message from ${message.sender.name}`,
    body: snippet,
    entityType: "conversation",
    entityId: conversationId,
    // A specific message can only ever be delivered to a specific
    // recipient once — messaging.ts emits exactly one MessageReceived per
    // (messageId, recipientId) pair, so this key is exact.
    dedupeKey: `message:${messageId}:${recipientId}`,
  });
});

onDomainEvent("AssessmentSubmitted", async ({ attemptId, studentId, assessmentId }) => {
  const [assessment, student] = await withRls(SYSTEM_CTX, (tx) =>
    Promise.all([
      tx.assessment.findUnique({ where: { id: assessmentId }, select: { title: true, courseId: true } }),
      tx.user.findUnique({ where: { id: studentId }, select: { name: true } }),
    ])
  );
  if (!assessment || !student) return;

  const teacherRows = await withRls(SYSTEM_CTX, (tx) =>
    tx.cohortTeacher.findMany({
      where: { cohort: { courseId: assessment.courseId } },
      select: { teacherUserId: true },
      distinct: ["teacherUserId"],
    })
  );

  for (const { teacherUserId } of teacherRows) {
    await createNotification({
      recipientId: teacherUserId,
      type: "assessment_submitted",
      title: `New submission: ${assessment.title}`,
      body: `${student.name} submitted "${assessment.title}".`,
      entityType: "attempt",
      entityId: attemptId,
      metadata: { assessmentId },
      // An Attempt is submitted at most once in its lifetime (a retake
      // creates a new Attempt row with its own id — see attempts.ts), so
      // (attemptId, teacherUserId) can only ever represent one real
      // occurrence.
      dedupeKey: `attempt:${attemptId}:submitted:${teacherUserId}`,
    });
  }
});

onDomainEvent("AssessmentGraded", async ({ attemptId, studentId, assessmentId }) => {
  const [attempt, assessment] = await withRls(SYSTEM_CTX, (tx) =>
    Promise.all([
      tx.attempt.findUnique({ where: { id: attemptId }, select: { gradedAt: true, scorePercent: true, passed: true } }),
      tx.assessment.findUnique({ where: { id: assessmentId }, select: { title: true } }),
    ])
  );
  if (!attempt?.gradedAt || !assessment) return;

  const scoreText = attempt.scorePercent != null ? `${Math.round(attempt.scorePercent)}%` : "pending review";
  const passText = attempt.passed == null ? "" : attempt.passed ? " (passed)" : " (not passed)";
  await createNotification({
    recipientId: studentId,
    type: "assessment_graded",
    title: `Graded: ${assessment.title}`,
    body: `Your score: ${scoreText}${passText}.`,
    entityType: "attempt",
    entityId: attemptId,
    // AssessmentGraded fires exactly once per attempt — either at
    // submit-time auto-grade or later at manual-grade completion, never
    // both (see attempts.ts's submitAttempt/gradeAttempt) — and gradedAt is
    // set once at that same moment, so this key is exact for that single
    // grading occurrence. A hypothetical future re-grade feature would set
    // a new gradedAt and correctly produce a new notification.
    dedupeKey: `attempt:${attemptId}:graded:${attempt.gradedAt.toISOString()}`,
  });
});

onDomainEvent("AssessmentAssigned", async ({ assignmentId, assessmentId, courseId, cohortId, studentUserId }) => {
  const assessment = await withRls(SYSTEM_CTX, (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { title: true } }));
  if (!assessment) return;

  let recipientIds: string[];
  if (studentUserId) {
    recipientIds = [studentUserId];
  } else if (cohortId) {
    const enrollments = await withRls(SYSTEM_CTX, (tx) =>
      tx.enrollment.findMany({ where: { cohortId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } }, select: { studentUserId: true } })
    );
    recipientIds = enrollments.map((e) => e.studentUserId);
  } else {
    return;
  }

  for (const recipientId of recipientIds) {
    await createNotification({
      recipientId,
      type: "assessment_assigned",
      title: `New assessment: ${assessment.title}`,
      body: `"${assessment.title}" has been assigned to you.`,
      entityType: "assessment",
      entityId: assessmentId,
      metadata: { courseId },
      // An AssessmentAssignment row is created at most once per
      // (assignmentId), and a cohort assignment's active-roster snapshot at
      // handling time is deterministic per recipient.
      dedupeKey: `assignment:${assignmentId}:${recipientId}`,
    });
  }
});

onDomainEvent("CoursePublished", async ({ courseId }) => {
  const course = await withRls(SYSTEM_CTX, (tx) => tx.course.findUnique({ where: { id: courseId }, select: { title: true, publishedAt: true } }));
  if (!course?.publishedAt) return;

  const enrollments = await withRls(SYSTEM_CTX, (tx) =>
    tx.enrollment.findMany({
      where: { cohort: { courseId }, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
      select: { studentUserId: true },
      distinct: ["studentUserId"],
    })
  );

  for (const { studentUserId } of enrollments) {
    await createNotification({
      recipientId: studentUserId,
      type: "course_published",
      title: `Course published: ${course.title}`,
      body: `"${course.title}" is now available.`,
      entityType: "course",
      entityId: courseId,
      // courses.ts's publishCourse() sets a fresh publishedAt on every
      // (re)publish (draft/archived -> published), so this key correctly
      // treats a republish as a new, real occurrence worth notifying again.
      dedupeKey: `course:${courseId}:published:${course.publishedAt.toISOString()}:${studentUserId}`,
    });
  }
});

onDomainEvent("StudentEnrolled", async ({ enrollmentId, studentId, courseId }) => {
  const [enrollment, course] = await withRls(SYSTEM_CTX, (tx) =>
    Promise.all([
      tx.enrollment.findUnique({ where: { id: enrollmentId }, select: { enrolledAt: true } }),
      tx.course.findUnique({ where: { id: courseId }, select: { title: true } }),
    ])
  );
  if (!enrollment || !course) return;

  await createNotification({
    recipientId: studentId,
    type: "student_enrolled",
    title: `Enrolled: ${course.title}`,
    body: `You've been enrolled in "${course.title}".`,
    entityType: "course",
    entityId: courseId,
    // courses.ts's enrollStudent() is called idempotently in places (e.g.
    // re-enrolling an already-active student is a no-op read, no DB write)
    // but still unconditionally re-emits StudentEnrolled with the SAME
    // enrolledAt in that case — this key correctly collapses that repeat
    // emission to a single notification, while a genuine withdraw-then-
    // re-enroll (which DOES bump enrolledAt) still produces a new one.
    dedupeKey: `enrollment:${enrollmentId}:${enrollment.enrolledAt.toISOString()}`,
  });
});

onDomainEvent("UserSuspended", async ({ userId }) => {
  const user = await withRls(SYSTEM_CTX, (tx) => tx.user.findUnique({ where: { id: userId }, select: { suspendedAt: true } }));
  if (!user?.suspendedAt) return;

  await createNotification({
    recipientId: userId,
    type: "account_suspended",
    title: "Account suspended",
    body: "Your account has been suspended. Contact an administrator for details.",
    // suspendedAt is refreshed on every suspendUser() call, so a
    // suspend -> reinstate -> suspend cycle correctly produces a fresh
    // notification each time.
    dedupeKey: `user:${userId}:suspended:${user.suspendedAt.toISOString()}`,
  });
});

onDomainEvent("RoleChanged", async ({ userId }) => {
  // RoleChanged's current payload ({userId, actorId}) carries neither a
  // timestamp nor which role/direction (assign vs. remove) changed — see
  // src/lib/users.ts's assignRole()/removeRole(), both of which emit the
  // exact same shape. There is therefore no natural idempotency key
  // available here (unlike every other listener in this file); this
  // dedupeKey is unique per call, i.e. this notification type has NO real
  // duplicate-delivery protection today. Documented explicitly in
  // docs/NOTIFICATIONS.md rather than faking a key that wouldn't actually
  // dedupe anything — see that doc for the precise contract change
  // (a timestamp and/or roleId on the event payload) that would fix this.
  await createNotification({
    recipientId: userId,
    type: "role_changed",
    title: "Role updated",
    body: "Your account roles were updated.",
    dedupeKey: `role_changed:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  });
});

onDomainEvent("CertificateIssued", async ({ certificateId, studentId }) => {
  // CertificateIssued is pre-typed since Session 01 but has no emitter yet
  // — Session 14 (Certificates) hasn't been built. This listener is ready
  // the moment it is: same "subscribe ahead of the emitter" precedent as
  // Session 08 self-subscribing to LessonCompleted, or this session's own
  // AssessmentAssigned listener above.
  await createNotification({
    recipientId: studentId,
    type: "certificate_issued",
    title: "Certificate issued",
    body: "Your certificate is ready.",
    entityType: "certificate",
    entityId: certificateId,
    // A given certificateId is issued exactly once by definition.
    dedupeKey: `certificate:${certificateId}`,
  });
});

onDomainEvent("ProjectMilestoneUpdated", async ({ projectId, milestoneId }) => {
  // Unemitted until Session 11 (Sponsor) exists — same "ready ahead of the
  // emitter" precedent as CertificateIssued above. ProjectMembership
  // (Sponsor Core's canonical membership table, per PLATFORM_DATA_MODEL.md)
  // is read directly rather than re-deriving sponsor/project visibility
  // rules here — this listener will need revisiting once Session 11 lands
  // its own project structure, since PLATFORM_DATA_MODEL.md's Project entity
  // is currently a stub (see docs/NOTIFICATIONS.md).
  const members = await withRls(SYSTEM_CTX, (tx) =>
    tx.projectMembership.findMany({ where: { projectId }, select: { userId: true } })
  );
  for (const { userId } of members) {
    await createNotification({
      recipientId: userId,
      type: "project_milestone_updated",
      title: "Project milestone updated",
      body: "A milestone on one of your projects was updated.",
      entityType: "project",
      entityId: projectId,
      dedupeKey: `milestone:${milestoneId}:${userId}`,
    });
  }
});

onDomainEvent("ArticleUnpublishedByAdmin", async ({ articleId, authorId }) => {
  // Session 39 (Keen Africans — Notifications). The one real event this
  // session wires: Session 34's admin-unpublish moderation safety valve
  // previously produced an AuditEvent only, with no signal to the author.
  const article = await withRls(SYSTEM_CTX, (tx) =>
    tx.article.findUnique({ where: { id: articleId }, select: { title: true, moderatedAt: true, moderationNote: true } })
  );
  if (!article?.moderatedAt) return;

  await createNotification({
    recipientId: authorId,
    type: "article_unpublished_by_admin",
    title: `Your article was unpublished: ${article.title}`,
    body: article.moderationNote
      ? `An admin took "${article.title}" down: ${article.moderationNote}. It's back in your drafts — you can address this and republish.`
      : `An admin took "${article.title}" down. It's back in your drafts — you can address this and republish.`,
    entityType: "article",
    entityId: articleId,
    // adminUnpublishArticle() sets a fresh moderatedAt on every call, so a
    // republish -> re-unpublish cycle correctly produces a new notification
    // each time (same "timestamp column as the real occurrence key"
    // convention as course_published's publishedAt above).
    dedupeKey: `article:${articleId}:unpublished_by_admin:${article.moderatedAt.toISOString()}`,
  });
});

onDomainEvent("VerificationStatusChanged", async ({ userId, status, reason }) => {
  // Session 40 (Keen Africans — LinkedIn Verification). The
  // "verification status" listener Session 39's own docstring
  // anticipated. Never fires for the self-service connect transition
  // (unverified/rejected -> linkedin_connected) — see events.ts's
  // VerificationStatusChanged comment for why: only a reviewer decision
  // (approve/reject) emits this.
  const row = await withRls(SYSTEM_CTX, (tx) =>
    tx.keenAfricanVerification.findUnique({ where: { userId }, select: { reviewedAt: true } })
  );
  if (!row?.reviewedAt) return;

  const title = status === "verified" ? "You're now a Verified Keen African" : "Your LinkedIn verification wasn't approved";
  const body =
    status === "verified"
      ? "A reviewer approved your connected LinkedIn profile. The Verified Keen African badge now shows on your profile and articles."
      : reason
        ? `A reviewer didn't approve your connected LinkedIn profile: ${reason}. You can reconnect LinkedIn to try again.`
        : "A reviewer didn't approve your connected LinkedIn profile. You can reconnect LinkedIn to try again.";

  await createNotification({
    recipientId: userId,
    type: "verification_status_changed",
    title,
    body,
    entityType: "user",
    entityId: userId,
    // approveVerification()/rejectVerification() set a fresh reviewedAt on
    // every call, so a reject -> reconnect -> re-review cycle correctly
    // produces a new notification each time, same convention as
    // ArticleUnpublishedByAdmin's moderatedAt-keyed dedupe above.
    dedupeKey: `verification:${userId}:${status}:${row.reviewedAt.toISOString()}`,
  });
});

// --- Review workflow (Session 45) ---------------------------------------
//
// The listeners docs/NOTIFICATIONS.md's "Extension points" specified when
// Session 39 deliberately left them unbuilt. All four notify the ARTICLE'S
// AUTHOR and nobody else — never the reviewer, who took the action and
// already knows (same "never notify the actor" rule ArticleUnpublishedByAdmin
// and UserFollowed follow).
//
// Every review transition stamps a fresh `reviewedAt` (see
// src/lib/articles.ts), so keying dedupe on it makes a real
// submit -> changes_requested -> resubmit -> approved cycle produce one
// notification per real decision — the same "timestamp column as the real
// occurrence key" convention as ArticleUnpublishedByAdmin's moderatedAt and
// VerificationStatusChanged's reviewedAt.

/** Shared re-fetch for the three review listeners — each re-reads under SYSTEM_CTX rather than trusting a row passed across the module boundary (events.ts's "Payload discipline" rule). */
async function fetchReviewedArticle(articleId: string) {
  return withRls(SYSTEM_CTX, (tx) =>
    tx.article.findUnique({ where: { id: articleId }, select: { title: true, reviewNote: true, reviewedAt: true } })
  );
}

onDomainEvent("ArticleApproved", async ({ articleId, authorId }) => {
  const article = await fetchReviewedArticle(articleId);
  if (!article?.reviewedAt) return;

  await createNotification({
    recipientId: authorId,
    type: "article_approved",
    title: `Approved: ${article.title}`,
    body: `A reviewer approved "${article.title}". You can publish it whenever you're ready.`,
    entityType: "article",
    entityId: articleId,
    dedupeKey: `article:${articleId}:approved:${article.reviewedAt.toISOString()}`,
  });
});

onDomainEvent("ArticleChangesRequested", async ({ articleId, authorId }) => {
  const article = await fetchReviewedArticle(articleId);
  if (!article?.reviewedAt) return;

  await createNotification({
    recipientId: authorId,
    type: "article_changes_requested",
    title: `Changes requested: ${article.title}`,
    // requestChanges() rejects an empty note, so reviewNote is always set
    // here — the fallback exists only for the theoretical case of the row
    // being edited between the emit and this re-fetch.
    body: article.reviewNote
      ? `A reviewer asked for changes to "${article.title}": ${article.reviewNote}. Edit it and submit for review again.`
      : `A reviewer asked for changes to "${article.title}". Edit it and submit for review again.`,
    entityType: "article",
    entityId: articleId,
    dedupeKey: `article:${articleId}:changes_requested:${article.reviewedAt.toISOString()}`,
  });
});

onDomainEvent("ArticleRejected", async ({ articleId, authorId }) => {
  const article = await fetchReviewedArticle(articleId);
  if (!article?.reviewedAt) return;

  await createNotification({
    recipientId: authorId,
    type: "article_rejected",
    title: `Not accepted: ${article.title}`,
    // Rejection is deliberately not terminal in Session 38's state machine
    // (rejected -> in_review via submitForReview again) — the body says so,
    // so the notification doesn't read as more final than the workflow is.
    body: article.reviewNote
      ? `A reviewer didn't accept "${article.title}": ${article.reviewNote}. You can still revise it and submit for review again.`
      : `A reviewer didn't accept "${article.title}". You can still revise it and submit for review again.`,
    entityType: "article",
    entityId: articleId,
    dedupeKey: `article:${articleId}:rejected:${article.reviewedAt.toISOString()}`,
  });
});

onDomainEvent("ArticlePublished", async ({ articleId, authorId, scheduled }) => {
  // Only ever emitted for a publish the author did not perform themselves
  // right then — see events.ts's ArticlePublished comment. Keyed on
  // publishedAt, which both publish paths stamp fresh, so an
  // unpublish -> republish cycle correctly notifies again.
  const article = await withRls(SYSTEM_CTX, (tx) =>
    tx.article.findUnique({ where: { id: articleId }, select: { title: true, publishedAt: true } })
  );
  if (!article?.publishedAt) return;

  await createNotification({
    recipientId: authorId,
    type: "article_published",
    title: `Published: ${article.title}`,
    body: scheduled
      ? `Your scheduled article "${article.title}" is now live on Keen Africans.`
      : `A reviewer published "${article.title}" on your behalf. It's now live on Keen Africans.`,
    entityType: "article",
    entityId: articleId,
    dedupeKey: `article:${articleId}:published:${article.publishedAt.toISOString()}`,
  });
});

onDomainEvent("UserFollowed", async ({ followerId, followedUserId }) => {
  // Session 42 (Follow & Author Reputation Display). The "follow" listener
  // Session 39's own docstring anticipated. Re-fetches the Follow row for
  // its own id/createdAt (never trusts an already-loaded row across the
  // module boundary — see events.ts's own "Payload discipline" rule) to
  // build a dedupe key on the relationship's own real occurrence: a
  // follower who unfollows and re-follows the same account produces a
  // NEW Follow row (a fresh id/createdAt, since unfollow is a real DELETE
  // — see schema.prisma's Follow comment), so this correctly notifies
  // again each time, same convention as every other listener here.
  const [follow, followerProfile] = await Promise.all([
    withRls(SYSTEM_CTX, (tx) =>
      tx.follow.findUnique({
        where: { followerId_followingId: { followerId, followingId: followedUserId } },
        select: { id: true, createdAt: true },
      })
    ),
    withRls(SYSTEM_CTX, (tx) => tx.profile.findUnique({ where: { userId: followerId }, select: { displayName: true } })),
  ]);
  if (!follow) return;

  const followerName = followerProfile?.displayName ?? "Someone";

  await createNotification({
    recipientId: followedUserId,
    type: "user_followed",
    title: `${followerName} followed you`,
    body: `${followerName} started following you on Keen Africans.`,
    entityType: "user",
    entityId: followerId,
    dedupeKey: `follow:${follow.id}`,
  });
});

// --- Read path: the in-app notification center ----------------------------

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export interface NotificationSummary {
  id: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
}

export interface ListMyNotificationsFilter {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ListMyNotificationsResult {
  notifications: NotificationSummary[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

function actorRlsCtxLocal(actor: AuthzActor) {
  return { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] };
}

/**
 * actor's own notification inbox — self-scoped both here and at the RLS
 * layer (notifications_select). There is no "view another user's
 * notifications" mode anywhere in this module, by design (the acceptance
 * criterion "Must NOT expose another user's notifications").
 */
export async function listMyNotifications(actor: AuthzActor, filter: ListMyNotificationsFilter = {}): Promise<ListMyNotificationsResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE));

  const where = { recipientId: actor.id, ...(filter.unreadOnly ? { readAt: null } : {}) };

  const [rows, total, unreadCount] = await withRls(actorRlsCtxLocal(actor), (tx) =>
    Promise.all([
      tx.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.notification.count({ where }),
      tx.notification.count({ where: { recipientId: actor.id, readAt: null } }),
    ])
  );

  return {
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      entityType: n.entityType,
      entityId: n.entityId,
      metadata: n.metadata,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
    total,
    unreadCount,
    page,
    pageSize,
  };
}

/** Lightweight unread-count-only read, for a topbar badge. */
export async function getUnreadNotificationCount(actor: AuthzActor): Promise<number> {
  return withRls(actorRlsCtxLocal(actor), (tx) => tx.notification.count({ where: { recipientId: actor.id, readAt: null } }));
}

/** Throws AuthorizationError unless actor is the notification's recipient (or super_admin). RLS backstops this identically. */
async function requireOwnNotification(notificationId: string, actor: AuthzActor): Promise<void> {
  if (actor.isSuperAdmin) return;
  const notification = await withRls(actorRlsCtxLocal(actor), (tx) =>
    tx.notification.findUnique({ where: { id: notificationId }, select: { recipientId: true } })
  );
  if (!notification || notification.recipientId !== actor.id) {
    throw new AuthorizationError("Not your notification");
  }
}

export async function markNotificationRead(notificationId: string, actor: AuthzActor): Promise<void> {
  await requireOwnNotification(notificationId, actor);
  await withRls(actorRlsCtxLocal(actor), (tx) =>
    tx.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } })
  );
}

export async function markAllNotificationsRead(actor: AuthzActor): Promise<void> {
  await withRls(actorRlsCtxLocal(actor), (tx) =>
    tx.notification.updateMany({ where: { recipientId: actor.id, readAt: null }, data: { readAt: new Date() } })
  );
}

/**
 * Maps a notification to the relative, portal-local route it should link to
 * (the "notification links to related entity" acceptance criterion). Shared
 * across all three portals' /notifications pages — safe because a given
 * recipient only ever operates within the one portal matching their role,
 * and each notification type is only ever produced for the audience whose
 * portal has the matching route (see docs/NOTIFICATIONS.md's table). Returns
 * null when there is nothing sensible to link to (no portal route exists
 * yet, e.g. project_milestone_updated ahead of Session 11's Sponsor portal)
 * — callers must render the notification as plain, non-clickable text in
 * that case rather than guessing a URL.
 */
export function notificationHref(n: Pick<NotificationSummary, "type" | "entityType" | "entityId" | "metadata">): string | null {
  switch (n.type) {
    case "message_received":
      return n.entityType === "conversation" && n.entityId ? `/messages/${n.entityId}` : null;
    case "assessment_graded":
      return n.entityType === "attempt" && n.entityId ? `/results/${n.entityId}` : null;
    case "assessment_submitted": {
      const meta = n.metadata as { assessmentId?: string } | null;
      return n.entityType === "attempt" && n.entityId && meta?.assessmentId
        ? `/assessments/${meta.assessmentId}/attempts/${n.entityId}`
        : null;
    }
    case "assessment_assigned":
      return n.entityType === "assessment" && n.entityId ? `/assessments/${n.entityId}` : null;
    case "course_published":
    case "student_enrolled":
      return n.entityType === "course" && n.entityId ? `/courses/${n.entityId}` : null;
    case "certificate_issued":
      return "/certificates";
    case "article_unpublished_by_admin":
    // Session 45 (review workflow). All four land on the author's own
    // editor view of the article — the place they act on the outcome
    // (publish an approved one, revise a changes-requested/rejected one).
    // article_published deliberately does NOT link to the public
    // /<username>/<slug> URL: that needs a username lookup, and this is a
    // pure function with no DB access (same constraint that leaves
    // user_followed hrefless below).
    case "article_approved":
    case "article_changes_requested":
    case "article_rejected":
    case "article_published":
      return n.entityType === "article" && n.entityId ? `/articles/${n.entityId}/edit` : null;
    case "account_suspended":
    case "role_changed":
    case "project_milestone_updated":
    // Session 42 (Follow & Author Reputation Display). Same "no href" call
    // as verification_status_changed above — the recipient sees who
    // followed them from the notification body text; linking to the
    // follower's profile would need a username, which this pure function
    // has no DB access to resolve from a bare user id.
    case "user_followed":
      return null;
    default:
      return null;
  }
}
