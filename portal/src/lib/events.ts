import { EventEmitter } from "node:events";

/**
 * Domain event bus — the mechanism referred to by PLATFORM_ARCHITECTURE.md
 * section 9 ("cross-module behavior should subscribe to events/contracts
 * rather than importing arbitrary internal logic").
 *
 * This is an in-process EventEmitter, not a queue. That's deliberate: the
 * whole platform is a single Next.js deployment today (one process, one
 * DB), so a broker would add operational cost with no present benefit.
 * If/when a module needs durable delivery, retries, or cross-process
 * fan-out, replace the transport inside emitDomainEvent/onDomainEvent —
 * every caller already goes through this module, so callers don't change.
 *
 * Convention for adding a new event:
 * 1. Add its name to DomainEventMap below with a payload type.
 * 2. The module that owns the entity emits it (never a consumer).
 * 3. Consumers subscribe with onDomainEvent — don't import the emitting
 *    module's internals to react to its side effects.
 * 4. Handlers must not throw synchronously into the emitter; catch and log
 *    (see onDomainEvent) so one bad listener can't break the emitting
 *    request.
 *
 * Payload shape: always include the entity id(s) and enough context for a
 * listener to look the rest up itself (listeners re-fetch under their own
 * RLS context — never pass already-loaded rows across module boundaries,
 * since that bypasses the row's owner's RLS scoping for whoever reacts).
 */
export interface DomainEventMap {
  UserCreated: { userId: string };
  UserSuspended: { userId: string; actorId: string };
  RoleChanged: { userId: string; actorId: string };
  CoursePublished: { courseId: string; actorId: string };
  StudentEnrolled: { enrollmentId: string; studentId: string; courseId: string };
  // courseId added by Session 08 (Progress & Adaptive Learning), the first
  // real emitter — Session 01 only reserved the name/shape as a guess.
  // Included per this file's own "Payload discipline" rule (enough context
  // for a listener to look the rest up itself) so a course-completion
  // listener never needs an extra round trip just to resolve it.
  LessonCompleted: { lessonId: string; studentId: string; courseId: string };
  AssessmentSubmitted: { attemptId: string; studentId: string; assessmentId: string };
  AssessmentGraded: { attemptId: string; studentId: string; assessmentId: string };
  // Added by Session 10 (Notifications), which needs an "a new assessment
  // was assigned to you" signal but does not own AssessmentAssignment
  // (Session 07's entity) — per CLAUDE_BUILD_RULES.md §2, this defines the
  // minimal contract without touching src/lib/assessments.ts's own
  // assignment-creation logic. Unemitted today (same "pre-typed, zero
  // emitters" state Session 01 left every event in originally) — Session 10
  // already subscribes to it (src/lib/notifications.ts), so the moment
  // whoever owns src/lib/assessments.ts adds one
  // `emitDomainEvent("AssessmentAssigned", ...)` call at the end of its
  // assignment-creation function, notifications start flowing with zero
  // further Notifications-side work. Exactly one of cohortId/studentUserId
  // is set, mirroring AssessmentAssignment.scope's own CHECK constraint.
  AssessmentAssigned: {
    assignmentId: string;
    assessmentId: string;
    courseId: string;
    cohortId?: string;
    studentUserId?: string;
  };
  CertificateIssued: { certificateId: string; studentId: string };
  MessageReceived: { messageId: string; conversationId: string; recipientId: string };
  ProjectMilestoneUpdated: { projectId: string; milestoneId: string };
  // Added by Session 17 (Organization Core). Unemitted by anything before
  // this session — the first real emitters are src/lib/organizations.ts.
  // membershipId is the organization_memberships row id; actorId is who
  // triggered the change (may equal userId for a self-service action like
  // requesting to join or leaving).
  OrganizationCreated: { organizationId: string; actorId: string };
  OrganizationMembershipChanged: {
    organizationId: string;
    membershipId: string;
    userId: string;
    actorId: string;
  };
  // Added by Session 39 (Keen Africans — Notifications). Session 34's
  // admin-unpublish moderation safety valve (src/lib/articles.ts's
  // adminUnpublishArticle()) previously emitted an AuditEvent only, with no
  // domain event and therefore no notification to the author. authorId is
  // included directly (rather than making the listener re-derive it) since
  // it's already on hand at the emit site and is exactly who should be
  // notified — never the acting admin. See docs/NOTIFICATIONS.md's
  // "Extension points" section for the sibling events (review workflow,
  // verification status, follow) intentionally NOT added here yet.
  ArticleUnpublishedByAdmin: { articleId: string; authorId: string; actorId: string };
  // Added by Session 40 (Keen Africans — LinkedIn Verification), the
  // "verification status" sibling event Session 39's own docstring
  // anticipated and deliberately left unadded. Emitted by
  // src/lib/verification.ts's approveVerification()/rejectVerification() —
  // never by the self-service connectLinkedIn() (that transition,
  // unverified/rejected -> linkedin_connected, is not a reviewer decision
  // and has no natural notification recipient beyond the account owner,
  // who already sees it immediately on their own /account page).
  VerificationStatusChanged: { userId: string; status: "verified" | "rejected"; actorId: string; reason?: string };
  // Added by Session 42 (Follow & Author Reputation Display), the "follow"
  // sibling event Session 39's own docstring anticipated and deliberately
  // left unadded. Emitted only by src/lib/follows.ts's followUser() — never
  // by unfollowUser() (no "someone unfollowed you" notification exists).
  // Deliberately just the two ids, not the Follow row itself — per this
  // file's own "Payload discipline" rule, the listener re-fetches the row
  // under its own RLS context to get the dedupe key (the relationship's own
  // id/createdAt), rather than trusting an already-loaded row passed across
  // the module boundary.
  UserFollowed: { followerId: string; followedUserId: string };
}

export type DomainEventName = keyof DomainEventMap;

const bus = new EventEmitter();
// Foundation-scale headroom: several modules subscribing to the same event
// (e.g. notifications + audit both on UserCreated) is expected, not a leak.
bus.setMaxListeners(50);

export function emitDomainEvent<K extends DomainEventName>(
  name: K,
  payload: DomainEventMap[K]
): void {
  bus.emit(name, payload);
}

export function onDomainEvent<K extends DomainEventName>(
  name: K,
  handler: (payload: DomainEventMap[K]) => void | Promise<void>
): () => void {
  const wrapped = (payload: DomainEventMap[K]) => {
    try {
      const result = handler(payload);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((err) => {
          console.error(`[events] handler for ${name} failed`, err);
        });
      }
    } catch (err) {
      console.error(`[events] handler for ${name} failed`, err);
    }
  };
  bus.on(name, wrapped);
  return () => bus.off(name, wrapped);
}
