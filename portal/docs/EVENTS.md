# Domain events / service boundaries

Mechanism: `src/lib/events.ts` — an in-process `EventEmitter` wrapped in a
typed `emitDomainEvent` / `onDomainEvent` pair. See the module's own comment
for the full rationale; summary:

- One process, one database today — a message broker (SQS/Kafka/etc.) would
  add operational cost this platform doesn't need yet. If that changes, the
  transport inside `events.ts` is the only thing that needs to change;
  callers don't.
- Event names and payload shapes are the contract in `DomainEventMap`. The
  list mirrors PLATFORM_ARCHITECTURE.md §9 and PLATFORM_CONTEXT.md's
  cross-module examples — `UserCreated`, `StudentEnrolled`,
  `LessonCompleted`, `AssessmentGraded`, `CertificateIssued`,
  `MessageReceived`, etc.
- **Ownership**: only the module that owns an entity may emit its events
  (e.g. only Identity/Session 02 emits `UserCreated`/`RoleChanged`; only
  Education Core emits `CoursePublished`/`LessonCompleted`). A consumer
  reacting to another module's event must not reach into that module's
  internals — subscribe via `onDomainEvent` instead.
- **Payload discipline**: payloads carry ids, not hydrated rows. A listener
  re-fetches under its own RLS context. Passing an already-loaded row across
  the boundary would let a listener see data the emitting request's RLS
  scope allowed but the listener's own context might not.
- **Failure isolation**: `onDomainEvent` catches and logs handler errors —
  a broken listener must never fail the request that emitted the event.

## Status as of Session 01 (Foundation)

The bus exists and is exercised by tests (`src/lib/events.test.ts`), but
**no module in this repository emits a real event yet** — `User`/`Sponsor`/
`Project` are the only entities that exist so far, and nothing currently
reacts to their creation. This is deliberate: Session 01 owns the mechanism
and contract, not the identity/education/sponsor flows that will emit into
it.

Session 02 (Identity & Security) is expected to be the first real emitter:
`UserCreated` on account creation, `RoleChanged` on a role/permission
change, `UserSuspended` on suspension — each already typed in
`DomainEventMap`. Later sessions add their own entries to the map as they
introduce the entities those events describe (do not pre-invent events for
entities — Course, Enrollment, Certificate, etc. — that don't exist in the
schema yet beyond what's already listed).

## Adding a new event

1. Add `EventName: { ...payload }` to `DomainEventMap` in `src/lib/events.ts`.
2. Emit it from the one module that owns the entity, right after the
   state change that defines the event (e.g. after the `UPDATE` that
   publishes a course, not before).
3. Subscribers call `onDomainEvent("EventName", handler)` where their module
   is wired up (e.g. a notifications listener registered once at startup).
