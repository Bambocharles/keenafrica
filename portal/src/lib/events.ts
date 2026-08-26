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
  LessonCompleted: { lessonId: string; studentId: string };
  AssessmentSubmitted: { attemptId: string; studentId: string; assessmentId: string };
  AssessmentGraded: { attemptId: string; studentId: string; assessmentId: string };
  CertificateIssued: { certificateId: string; studentId: string };
  MessageReceived: { messageId: string; conversationId: string; recipientId: string };
  ProjectMilestoneUpdated: { projectId: string; milestoneId: string };
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
