# Notifications (Session 10, extended by Session 39)

The ONE canonical notification center for the whole platform
(`PLATFORM_CONTEXT.md`'s "Shared communication rule";
`PLATFORM_ARCHITECTURE.md` lists notifications as a Platform Core service).
Every portal — Admin/Teacher/Student/Sponsor/Keen Africans — reads and
writes through `src/lib/notifications.ts` over the single `notifications`
table. No portal owns a parallel notification table
(`CLAUDE_BUILD_RULES.md` §3).

This document was supposed to exist since Session 10 (its own handoff
instruction: "Document notification types/events and delivery contracts")
but never did. Written now, by Session 39, because that session touches
this file directly — it documents Session 10's original design as well as
Session 39's additions.

## Ownership boundary

`notifications.ts` never decides that something happened — that's entirely
the owning module's job (Messaging decides a message was sent, Assessment
decides an attempt was graded, Keen Africans' `articles.ts` decides an
article was unpublished by an admin, ...). This module only decides **how**
to tell a user about it, exclusively by subscribing to
`src/lib/events.ts`'s `DomainEventMap`. `createNotification()` is **not** a
caller-facing API for other modules — the only sanctioned way to make a
notification appear is to emit (or already have emitted) a domain event.

## Event -> notification mapping

| Domain event | NotificationType | Recipient(s) | Owning module |
|---|---|---|---|
| `MessageReceived` | `message_received` | the message recipient | Messaging |
| `AssessmentAssigned` | `assessment_assigned` | the assigned student(s) | Assessment |
| `AssessmentSubmitted` | `assessment_submitted` | the course's teacher(s) | Assessment |
| `AssessmentGraded` | `assessment_graded` | the student | Assessment |
| `CoursePublished` | `course_published` | actively enrolled students | Education Core |
| `StudentEnrolled` | `student_enrolled` | the enrolled student | Education Core |
| `CertificateIssued` | `certificate_issued` | the student | Certificates |
| `UserSuspended` | `account_suspended` | the suspended user | Identity |
| `RoleChanged` | `role_changed` | the affected user | Identity |
| `ProjectMilestoneUpdated` | `project_milestone_updated` | project members | Sponsor Core |
| `ArticleUnpublishedByAdmin` | `article_unpublished_by_admin` | the article's author | Keen Africans (`articles.ts`) |

Each row is a single `onDomainEvent(...)` listener in `notifications.ts`.
Adding a new mapped event means: add it to `DomainEventMap`
(`events.ts`), emit it from the owning module, add a listener here, add its
`NotificationType` value (own migration — Postgres enum values can't be
added and used in the same transaction), and a `notificationHref()` case.

## Duplicate-delivery protection

Every listener derives a `dedupeKey` from the driving event's own natural
identity (a specific `messageId`, a specific attempt's `gradedAt`, an
article's `moderatedAt`, ...) — see each listener's own comment in
`notifications.ts` for exactly what makes that key unique per **real**
occurrence, not just per event name. `createNotification()` upserts against
the `notifications_recipient_id_dedupe_key_key` unique constraint, so
redelivering the same occurrence (a re-registered listener, an idempotent
caller, or a future durable-queue redelivery once `events.ts`'s transport is
swapped) creates at most one row and triggers channel delivery at most
once.

One known gap: `RoleChanged`'s payload (`{userId, actorId}`) carries neither
a timestamp nor which role/direction changed, so `role_changed` has no real
dedupe key today (documented in that listener's own comment). Fixing it
means adding a timestamp and/or `roleId` to the event payload — a
Session-02-owned change, not Notifications'.

## Delivery channels

In-app (the `notifications` row itself) is always on, not flag-gated — same
"core plumbing" treatment as audit/progress. Everything else goes through
the `NotificationChannel` interface:

- **email** — real, functional, backed by `src/lib/mailer.ts`'s dev-stub
  `sendMail()`. Gated behind `FEATURE_FLAGS.NOTIFICATIONS_EMAIL` (seeded
  off — `mailer.ts` throws in production since no real transactional email
  provider exists yet).
- **push / SMS / WhatsApp** — reserved flag keys only
  (`NOTIFICATIONS_PUSH`/`_SMS`/`_WHATSAPP`), no implementation at all (no
  provider, no library, no dev-stub for any of them). Implementing one:
  write a `NotificationChannel`, push it into `CHANNELS`, wire its
  `isEnabled()` to the matching flag.

A channel failure never breaks in-app delivery (already committed) or any
other channel — see `dispatchToChannels()`'s try/catch.

## Preferences (Session 39)

Session 10's own brief listed "notification preferences" under its Owns
section but never built it. Session 39 added it — generically, on
`NotificationType`, not as a Keen-Africans-specific mechanism, since
`CLAUDE_BUILD_RULES.md` §3's "no parallel notification system" extends to
not forking its preferences either.

`NotificationPreference` (`user_id`, `type`, `enabled`, unique on
`(user_id, type)`) holds **only opt-outs**: absence of a row for a
`(user, type)` pair means enabled — the same default behavior every
notification type had before this table existed. `setNotificationPreference()`
deletes the row entirely when a user re-enables a type, rather than writing
an `enabled=true` row, so the table only ever grows with genuine opt-outs.

Checked once, centrally, inside `createNotification()` (`isNotificationEnabled()`)
— no per-listener changes needed for this or any future notification type.
An opted-out recipient gets **no row at all** for that occurrence (not a
suppressed-but-recorded one) and `createNotification()` returns
`{ created: false }`, the same shape a deduped delivery returns.

RLS: self-only read/write/update/delete (`notification_preferences_*`
policies, `keen_africans_notification_preferences` migration) — unlike
`notifications` itself (system-written, no acting user at write time), a
preference row is written directly by the owning user through a real
request context.

Today only one type has a settings UI: `article_unpublished_by_admin`, on
`keenafricans.<root>/account`
(`src/app/keenafricans/(protected)/account/actions.ts`'s
`updateArticleUnpublishedPreferenceAction`). Extending this to more types
(once Sessions 38/40/42 land, see below) is a matter of adding more
checkboxes to that form and, for other portals, building their own settings
UI over the same `getNotificationPreference()`/`setNotificationPreference()`
functions — no changes needed to the underlying mechanism.

## Notification center pages

Every portal that grants a role capable of receiving notifications has a
`/notifications` page reading `listMyNotifications()` and a topbar
`NotificationBell` (`src/components/ui/NotificationBell.tsx`) showing
`getUnreadNotificationCount()`. `notificationHref()` maps a notification to
the relative, portal-local route it should link to — returns `null` when no
sensible route exists yet, in which case callers render the notification as
plain, non-clickable text.

Session 35 added the Keen Africans topbar bell but never built the page it
linked to (a 404 until Session 39) — Session 39 added
`src/app/keenafricans/(protected)/notifications/` (page + actions),
mirroring the Student portal's page exactly.

## Session 39 — Keen Africans wiring

Session 34 shipped the admin-unpublish moderation safety valve
(`src/lib/articles.ts`'s `adminUnpublishArticle()`) with no signal to the
affected author beyond noticing it themselves on their own dashboard.
Session 39 wired exactly one real event:

- **`ArticleUnpublishedByAdmin`** (`{ articleId, authorId, actorId }`,
  emitted from `adminUnpublishArticle()` right after its `AuditEvent`) ->
  **`article_unpublished_by_admin`** (the one new `NotificationType` value
  this session added), notifying the article's author (never the acting
  admin). `notificationHref()` links it to `/articles/{id}/edit`. Dedupe
  key: `article:{articleId}:unpublished_by_admin:{moderatedAt.toISOString()}`
  — a republish -> re-unpublish cycle correctly produces a fresh
  notification (moderatedAt is refreshed on every call), while redelivering
  the same occurrence is suppressed.

### Extension points — deliberately NOT built by Session 39

Per that session's own brief ("order-independent from Sessions 40/42... if
those haven't shipped yet, wire only the events that exist today"), the
following were checked and confirmed **not yet landed** as of Session 39,
so no `NotificationType` values or listeners were added for them —
guessing at their shape ahead of the owning session risks a Postgres enum
value this codebase can never cleanly drop:

- ~~**Review workflow (Session 38)**~~ — **DONE, Session 45.** Session 38
  landed the workflow but never came back for the notifications, and
  neither did Sessions 39-44, so until Session 45 an author who submitted
  an article for review was told nothing about the outcome either way.
  Built exactly to the contract this entry specified: four
  `NotificationType` values in their own migration
  (`20260905110000_keen_africans_notification_type_review_workflow`), one
  `DomainEventMap` entry per transition (`ArticleApproved`,
  `ArticleChangesRequested`, `ArticleRejected`, plus `ArticlePublished` —
  see below), one listener each here, all notifying the article's author
  and never the reviewer, dedupe keyed on `Article.reviewedAt` exactly as
  this entry proposed.

  `article_published` is the one addition beyond this entry's original
  three. It fires only where an article goes live without its author
  pressing publish at that moment: an `articles.manage` holder publishing
  on the author's behalf (`publishArticle()` with `actorId !== authorId`),
  and `flipDueScheduledArticles()` flipping a deferred publish the author
  set earlier via `scheduleArticle()`. A plain self-publish emits nothing.

  All four `notificationHref()` to `/articles/<id>/edit` — the author's own
  editor view, where they act on the outcome. `article_published`
  deliberately does not link to the public `/<username>/<slug>` URL:
  resolving a username needs DB access that pure function doesn't have (the
  same constraint that leaves `user_followed` hrefless).
- **Verification status (Session 40)** — `Profile`
  (`prisma/schema.prisma`) has no verification-status field yet (Session
  36's handoff explicitly reserved a `data-verification-badge-slot` UI hook
  for this, nothing more). Once it lands: a `verification_status_changed`
  `NotificationType`, a `VerificationStatusChanged` domain event, a
  listener notifying the profile's owner.
- **Follow (Session 42)** — no `Follow`/`Following` entity exists yet in
  `prisma/schema.prisma`. Once it lands: a `user_followed` `NotificationType`,
  a `UserFollowed` domain event (`{followerId, followedUserId}`), a listener
  notifying `followedUserId` (never the follower), with a dedupe key on the
  follow relationship's own id/created timestamp (a given follower
  following the same user twice must not double-notify).

## Cleanup convention for tests

`src/lib/test-support.ts`'s `cleanupTestNotifications()` and (Session 39)
`cleanupTestNotificationPreferences()` must run before
`cleanupTestUsers()` deletes the underlying `User` rows — both FKs are
`ON DELETE NO ACTION`, same convention as every other cleanup helper in
that file. `cleanupTestUsers()` already calls both internally.
