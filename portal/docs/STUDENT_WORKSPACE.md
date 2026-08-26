# Student Workspace (Session 06)

The student-facing application, built entirely on top of Education Core
(Session 04) and Identity & Security (Session 02) — no parallel course
model, no parallel identity system, no parallel messaging/notification/
progress system. Where a required capability doesn't exist yet (Messaging,
Notifications, Assessment, Progress, Certificates), this session wires the
entry point and reports the gap as BLOCKED rather than building a
placeholder version of another session's owned system, per
`CLAUDE_BUILD_RULES.md` §2.

## Routes

All served under the `student.` subdomain (`src/middleware.ts` rewrites
`student.<ROOT_DOMAIN>/*` → `/student/*`, same shape as the existing
`admin.` rewrite; `"student"` added to `RESERVED_SLUGS` so it's never
mistaken for a sponsor/project tenant slug).

- `/login`, `/reset-password` — public. Reuses Session 02's
  `auth()`/`signIn()`/`signOut()` and `resetPassword()` as-is — no parallel
  auth. `/reset-password` mirrors `/admin/reset-password`'s public
  token-consumption page (`resetPassword()` isn't admin-specific).
- `/dashboard` — Continue Learning, My Courses, at-a-glance counts.
- `/courses`, `/courses/[courseId]`, `/courses/[courseId]/lessons/[lessonId]`
  — My Learning: enrollment list, course module/lesson tree, lesson viewer
  (content, resources, per-lesson notes, bookmark toggle). Built entirely
  over `listMyEnrollments()`/`getCourseContentForStudent()`
  (`src/lib/courses.ts`/`src/lib/content.ts`) — no new content-fetching
  logic, no new ownership checks.
- `/practice` — flat, any-order, searchable list of every published lesson
  across every active/completed enrollment (distinct from `/courses`'
  per-course sequential tree). Composed from the same two functions above;
  no new authorization logic.
- `/progress` — enrollment status only (active/completed/withdrawn,
  enrolled/completed dates) plus published module/lesson counts as context.
  Deliberately does **not** compute a completion percentage or mastery
  score — see "Progress — what this page does and doesn't show" below.
- `/notes`, `/saved` — all of the student's own notes / bookmarks, filterable
  by course.
- `/assessments`, `/results`, `/certificates`, `/messages` — entry points
  only; each renders `BlockedFeature` with the exact contract the owning
  session (07/09/10/14) is expected to satisfy. See "Blocked entry points"
  below.
- `/profile` — name/email/roles (from `session.user`, not a DB fetch — see
  "Why not `getUserById`" below) plus a self-service password-reset-link
  request.

## Data model additions

Two new tables, both private/self-owned, neither part of Education Core:

- `student_notes` (`StudentNote`) — a note attached to a
  course/module/lesson/resource, or (once Session 07 exists) a question,
  via a lightweight `targetType`/`targetId` pair rather than one nullable
  FK column per type (a real FK to a future `Question` table isn't even
  possible yet). `courseId` is always populated, denormalized the same way
  `Lesson.courseId` is, so the enrollment check is a single join.
- `bookmarks` (`Bookmark`) — same shape, restricted to `lesson`/`resource`.

Migration: `20260826191205_student_workspace`. Additive only — no existing
table/policy touched.

## Privacy model (important)

Notes and bookmarks are **private to the owning student** — not visible to
that course's teacher, not visible to other students, not part of course
content. This is enforced at two independent layers, the same "defense in
depth" shape Session 04 established for draft-content visibility:

1. **Application layer** — every read/write in `src/lib/notes.ts`/
   `src/lib/bookmarks.ts` is explicitly scoped by `studentUserId`, not left
   to RLS alone.
2. **Database layer** — `student_notes_*`/`bookmarks_*` RLS policies
   (self-only, `is_super_admin` bypass for symmetry with every other
   table's policy shape; no admin UI reads/writes these).

**Why layer 1 matters, concretely**: while writing this session, an early
version of `updateNote`/`deleteNote`/`removeBookmark` relied on RLS alone
to scope an ownership lookup (`findUnique({ where: { id } })` with no
`studentUserId` filter). That passed fine against the RLS policies in
theory, but the local dev/test `prisma` connection is the Postgres
**superuser**, which always bypasses RLS regardless of policy (the same
caveat `src/lib/rls.integration.test.ts`'s header comment documents) — so
under that connection, any student could update/delete any other
student's note or bookmark. A negative-authorization test caught this
immediately (`src/lib/notes.test.ts`/`bookmarks.test.ts`); fixed by
explicitly filtering the ownership lookup by `studentUserId` at the
application layer, mirroring `content.ts`'s `requireCourseContentAccess()`
pattern rather than relying on RLS as the only gate. The DB-level policy
is still independently proven correct in
`src/lib/student-workspace-rls.integration.test.ts` against the real
non-superuser `portal_rls_test` role. **Takeaway for future sessions**:
never write an app-layer mutation that trusts RLS alone to scope an
ownership lookup — the production app role has no `BYPASSRLS`, but every
local dev/test connection does, so a missing app-layer check is invisible
until it's proven against `portal_rls_test` specifically, or exploited in
production.

Note/bookmark creation also validates that `targetId` actually belongs to
`courseId` and — for module/lesson/resource — is currently **published**,
not a draft the student has no business referencing. Attempting to note a
draft lesson resolves to the same `AuthorizationError` as attempting to
note a lesson in a course you're not enrolled in, so it also can't be used
to infer that a given draft lesson id exists.

## Permissions

No new permission keys. Every capability in this session is either:

- **Coarse shell access** — `canAccessStudentPortal(actor)`
  (`src/lib/authz.ts`), `STUDENT` role or `isSuperAdmin`, same shape as
  `canAccessAdminConsole()`. Every page inside still enforces its own
  ownership scoping — reaching the shell alone grants no data access.
- **Self-scoped, no permission required** — notes/bookmarks/enrollments/
  course content, exactly matching `listMyEnrollments()`'s existing "no
  permission required beyond self-scoping" shape from Session 04.

## Why not `getUserById` for `/profile`

Session 03's handoff flagged this exact gap: `getUserById`/`listUsers` are
gated on `users.read` unconditionally, "not an ownership bypass... flag
this if a future admin-console role without `users.read` needs to view its
own profile through these functions." `STUDENT` holds no permissions by
default, so it can't call `getUserById` for its own row. Rather than
widening `getUserById` (Identity & Security's owned function) or adding a
new permission for something that doesn't need one, `/profile` reads
directly from `session.user` (`id`/`name`/`email`/`roles`/`isSuperAdmin`),
which the JWT session already carries — no DB round-trip, no permission
gap.

**Merge-time note**: Session 05 (Teacher), built in parallel on a sibling
branch, hit the identical gap and independently added
`getOwnProfile(actor)` to `src/lib/users.ts` (self-scoped, no permission
required), recommending Session 06 reuse it. That function doesn't exist
in this branch (it postdates the commit this branch forked from). Since
this session never lets a student edit their own name, `session.user`
never goes stale the way Session 05's teacher-name-edit case did (root
cause: `auth.ts`'s `jwt` callback doesn't refresh `token.name`), so no
bug exists here today — but once the branches merge, `/profile` could
switch to `getOwnProfile()` for consistency with the Teacher workspace and
future-proofing if a name-edit form is ever added here.

## Self-service password reset

`requestPasswordReset()`/`resetPassword()` (Session 02) do no authorization
of their own by design (the future public "forgot password" flow needs to
call them pre-auth). `/profile`'s "Send myself a password reset link"
action is the first *authenticated self-service* caller: safe specifically
because the caller already proved their identity by being logged in and is
requesting a reset for their own email, unlike Session 03's admin-triggered
path (which acts on someone else's account and is gated on
`users.update`). Same short-lived-cookie delivery Session 03 established:
no transactional email provider exists yet (Session 02's open blocker), so
the one-time link is shown directly to the requester rather than left
undeliverable. `/student/reset-password` is a new public token-consumption
page mirroring `/admin/reset-password` — `resetPassword()` isn't
admin-specific, it just didn't have a second public entry point yet.

## Progress — what this page does and doesn't show

There is no canonical `Progress`/completion-tracking model. Session 04's
own handoff says so directly ("`Enrollment.completedAt` exists in the
schema but nothing sets it yet — needs a Progress model"), and Session 08
(Progress & Adaptive Learning) explicitly owns "lesson/module/course
progress" and "completion tracking" per its spec. Per this session's own
"Must NOT calculate authoritative mastery locally" and
`CLAUDE_BUILD_RULES.md` §2, `/progress` does **not** invent a completion
percentage, a "N of M lessons done" figure, or any mastery score — there is
no per-lesson completion signal anywhere in the schema to compute one from.
It shows only real `Enrollment` fields (`status`, `enrolledAt`,
`completedAt`, `withdrawnAt`) plus how much published content exists, with
an explicit banner naming Session 08 as the owner of real progress
tracking.

## Blocked entry points

Per the build instructions for this session, the following acceptance-
criteria items are wired as entry points but the underlying capability
doesn't exist, so each renders a `BlockedFeature` (`src/app/student/
(protected)/BlockedFeature.tsx`) naming the owning session and the
contract it's expected to satisfy, rather than a placeholder implementation:

| Route | Owning session | What's missing |
|---|---|---|
| `/assessments` | 07 (Assessment) | `Question`/`Assessment`/`Attempt`/`Answer`/`Result` — no assignment/attempt flow exists |
| `/results` | 07 (Assessment) | Same — no `Attempt`/`Result` to read |
| `/certificates` | 14 (Certificates) | `Certificate` entity; also depends on Session 08's Progress for issuance criteria |
| `/messages` | 09 (Messaging) | `Conversation`/`Message` — **the session's own acceptance criterion "student can message teacher/other permitted students" is explicitly BLOCKED here**, per this session's build instructions ("stub/report BLOCKED where the underlying capability doesn't exist yet, rather than building placeholder versions of those systems yourself") — do not build a student-only messaging table to satisfy this |

The `messaging`/`certificates` feature flags (Session 01) already exist and
are read (`isFeatureEnabled()`) on the relevant stub pages to surface their
current state, but gate nothing yet — there's no real feature behind them
for a flag to hide.

`notifications` (dashboard bullet) has the same status as messages — no
`Notification` entity exists (Session 10). Not a dedicated stub page since
the session brief lists it only as a dashboard element, not a full route;
the dashboard simply doesn't render a notifications section.

## Mobile/responsive

Reuses the exact `layout.module.css` shell/sidebar/nav CSS Session 03
authored for the admin console verbatim (including its `@media
(max-width: 760px)` collapse), so the same responsive behavior applies
without re-deriving it.

## Empty/loading/error states

- Empty: `EmptyState` (shared UI kit) on every list (My Learning, notes,
  saved, practice, progress).
- Loading: `src/app/student/(protected)/loading.tsx` (Next.js route
  Suspense boundary).
- Error: `src/app/student/(protected)/error.tsx` (client error boundary,
  "try again" reset).
- Permission denied: an `AuthorizationError` from `assertActiveEnrollment`
  (not-enrolled course/lesson) renders an inline `Banner`, same pattern
  Session 04's admin education page uses. The coarse shell gate
  (non-`STUDENT` authenticated user) redirects to `/login`, matching the
  admin console's identical precedent — not a distinct "permission denied"
  page, by design consistency with the existing app.

## Verification

- `npm test` — 154/154 passing (up from 133), including:
  - `src/lib/notes.test.ts`, `src/lib/bookmarks.test.ts` — positive +
    negative authorization (unenrolled student, draft-content target,
    cross-student read/update/delete, course teacher cannot read a
    student's notes).
  - `src/lib/student-workspace-rls.integration.test.ts` — the same
    boundaries proven against the real non-superuser `portal_rls_test`
    role, independent of application code (skips if
    `RLS_TEST_DATABASE_URL` is unset, same convention as Session 04's
    `education-rls.integration.test.ts`).
- `npx tsc --noEmit` and `npm run build` both pass.
- **Live E2E verification against a real running dev server** (this
  session did have `curl` available for exact multipart Server Action
  replication, following Session 03/04's precedent where no browser
  automation was available): seeded a real course/cohort/enrollment/
  module/published-lesson/draft-lesson via the public
  `courses.ts`/`content.ts` API, logged in as a real `STUDENT` via
  `POST /auth/callback/credentials`, and confirmed —
  - every student route returns 200 authenticated, 307→`/login`
    unauthenticated;
  - a non-`STUDENT` authenticated user (a `TEACHER` account) is also
    redirected to `/login` at the shell gate;
  - the draft lesson's content never appears anywhere — not in the course
    tree, not by direct URL to `/courses/[id]/lessons/[draftId]` (returns
    an inline "not available" banner, not the content);
  - a student never enrolled in the course is rejected outright on both
    the course page and the lesson page, with zero content leaked;
  - submitted the real "Add note" and "Save" (bookmark) `<form>` Server
    Actions with the exact `$ACTION_ID_*` multipart encoding React emits,
    confirmed the rows actually landed in Postgres, and confirmed they
    then rendered correctly on `/notes`, `/saved`, and the dashboard's
    counts;
  - confirmed a different (outsider) student's `/notes` and `/saved`
    pages stayed empty — the first student's private data never leaked
    across accounts.
  All smoke-test data (users, course, and its cascade) was cleaned up
  afterward directly in Postgres.

## Known limitations

- `/practice` and `/progress` call `getCourseContentForStudent()` once per
  enrolled course sequentially awaited in `Promise.all` — fine at
  foundation scale (a handful of courses per student), revisit if a
  student's enrollment count ever grows large.
- No pagination on `/notes`/`/saved`/`/practice` — acceptable at current
  demo-data scale; add if the canonical seed (Session 15) ever produces a
  student with a large note/bookmark count.
- No UI to edit a note's text on `/notes` itself (only from the lesson
  page's note list, which doesn't have inline edit either — only delete +
  re-add). `updateNote()` exists and is tested; wiring an edit form is a
  small follow-up, not done here to keep the surface area tight.
- Practice/progress flatten lesson data without deduplicating by lesson id
  across enrollments — not currently possible to double-enroll in the same
  cohort (`enrollments` has a `[cohortId, studentUserId]` unique
  constraint) but a student enrolled in two different cohorts of the same
  course would see that course's lessons once per cohort. Edge case, not
  hit by the canonical demo-data shape.

## Blockers

- None for this session's own scope. `/assessments`, `/results`,
  `/certificates`, `/messages` are documented BLOCKED entry points (see
  table above), each naming the exact owning session and contract — not a
  blocker on *this* session's completion, since building those systems is
  explicitly out of bounds per `CLAUDE_BUILD_RULES.md` §2.

## Required next-session actions

- **Session 07 (Assessment)**: `/assessments` and `/results` are ready to
  be filled in — replace their `BlockedFeature` bodies with real
  `listAssignedAssessments(actor)`/`listMyResults(actor)`-shaped calls,
  self-scoped the same way every `listMy*()` function in this session is.
- **Session 08 (Progress & Adaptive Learning)**: `/progress` is
  deliberately minimal — once a real `Progress`/completion model exists,
  replace its enrollment-only view with the real per-lesson/module
  completion and topic-mastery data. Do not let this session's provisional
  view become the de facto contract.
- **Session 09 (Messaging)**: `/messages` is the entry point — this
  session's own acceptance criterion ("student can message teacher") is
  carried forward to Session 09 to actually satisfy.
- **Session 10 (Notifications)**: the dashboard has no notifications
  section at all yet (not even a stub) — add one once `Notification`
  exists, following this session's `BlockedFeature` pattern if built
  before that.
- **Session 14 (Certificates)**: `/certificates` is the entry point;
  "student certificate view" is explicitly Session 14's own owned scope
  per its spec, so it may replace this stub page's contents directly
  rather than this session extending it further.
- **Whoever touches `src/middleware.ts` next (likely Session 05, Teacher,
  concurrently)**: this session added a `"student"` branch structurally
  identical to `"admin"`. If Session 05 adds a `"teacher"` branch around
  the same time, expect a small, easy-to-resolve merge conflict on this
  file — not a design conflict, just adjacent lines.
