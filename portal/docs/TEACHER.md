# Teacher Workspace (Session 05)

The teacher-facing application built on top of Session 04's Education Core.
No new tables, no new permission model shape — this session is entirely a
UI + a small number of narrow, additive library extensions over
`src/lib/courses.ts`/`src/lib/content.ts`/`src/lib/topics.ts`.

## Where it lives

`teacher.<ROOT_DOMAIN>` (mirrors `admin.<ROOT_DOMAIN>` — see
`src/middleware.ts`) serves `src/app/teacher/**`, the same rewrite pattern
Session 01/02/03 established for `admin.`. Session 06 (Student) is expected
to add its own `student.` branch the same way, in parallel.

Routes:
- `/login` — Credentials sign-in, reusing `src/lib/auth.ts` as-is (no new
  auth flow).
- `/dashboard` — course/cohort/student counts, quick links.
- `/courses`, `/courses/[id]` — the authoring surface (see below).
- `/messages`, `/assessments` — wired entry points, both BLOCKED (see
  Blockers).
- `/profile` — self view/edit (name only).

`(protected)/layout.tsx` gates on `canAccessTeacherPortal()`
(`src/lib/authz.ts`) — `isSuperAdmin` or the `TEACHER` role. This is only
the coarse "can see the workspace shell" check, exactly like
`canAccessAdminConsole()`. Every page/action inside still calls into
`courses.ts`/`content.ts`, which independently enforce ownership via
`cohort_teachers` (`requireCourseContentAccess()`) — holding the `TEACHER`
role with no cohort assignment grants nothing.

## What this session built vs. reused

Reused verbatim, no changes: `createModule`, `updateModule`,
`reorderModules`, `publishModule`, `unpublishModule`, `createLesson`,
`updateLesson`, `reorderLessons`, `publishLesson`, `unpublishLesson`,
`addResource`, `removeResource`, `tagLesson`, `untagLesson`, `listTopics`,
`listMyCourses`, `getCourseById`, `listCohortsForCourse`,
`listEnrollmentsForCohort`, `updateUserProfile`.

Two small, additive extensions to existing modules (both backward
compatible — no existing caller's behavior changes):
- `getCourseContentForTeacher()` (`src/lib/content.ts`) now also includes
  each lesson's `topics: { include: { topic: true } }`, so the authoring UI
  can render/untag topic pills without a second round-trip. Its only
  existing caller was `content.test.ts`, which destructures specific
  fields and is unaffected by the extra included relation.
- `getOwnProfile(actor)` (`src/lib/users.ts`) — a new, deliberately
  narrow, self-scoped read (`WHERE id = actor.id`, always, never a
  parameter) requiring no permission at all. This exists because
  `getUserById()`/`listUsers()` require `users.read`, which
  `ADMIN_CONSOLE_ROLES` all hold but a plain `TEACHER`/`STUDENT` does not —
  exactly the gap Session 03's handoff flagged ("flag this if a future
  admin-console role without users.read needs to view its own profile").
  Reading one's own row is already permitted at the RLS layer regardless
  (`users_select`'s `"id" = app.user_id` self clause) — this just gives the
  application layer a function to use that self-permission through, instead
  of over-requiring `users.read` for a case that was never actually gated
  by it. Found live: without this, `/profile` displayed the JWT session's
  `name` claim, which `auth.ts`'s `jwt` callback never refreshes after
  login (unlike roles/permissions/isSuperAdmin) — so a teacher's own
  successful name update didn't visibly take effect until they logged out
  and back in. Fixed by reading fresh from the DB instead of trusting
  `session.user.name` for display.

New in this session, in `src/app/teacher/**` only (no `src/lib` additions
beyond the two above): the entire authoring page (module/lesson CRUD,
move-up/down reordering via `reorderModules`/`reorderLessons`, publish/
unpublish, resource attach/remove, topic tag/untag), the dashboard, the
profile page, and the two BLOCKED entry-point pages.

## Cohort/course visibility — what "authorized" means here

`listMyCourses()` filters at the application layer
(`cohorts: { some: { teachers: { some: { teacherUserId: actor.id } } } }`)
— a teacher never sees a course they have no cohort assignment on, full
stop.

`listCohortsForCourse()`/`listEnrollmentsForCohort()` are coarser at the
**application** layer — their authorization check
(`assertCanManageOrTeachCourse`) only confirms the actor teaches *some*
cohort of the course, then queries with no further cohort filter. The
`cohorts_select`/`enrollments_select` RLS policies (Session 04's migration)
are per-**cohort**, not per-course, and independently narrow the actual
result set to only the cohort(s) the actor teaches. Production's
`kf_portal_prod_app` DB role does **not** bypass RLS (see
`docs/ENVIRONMENT.md`), so this narrowing is real in production, not
theoretical — proved against the real non-superuser `portal_rls_test` role
in `src/lib/teacher-cohort-rls.integration.test.ts` (a teacher assigned to
Cohort A of a course cannot see sibling Cohort B's roster, even though the
app-layer check alone would have let the call through). Not changed here —
Education Core's ownership model belongs to Session 04 — but documented
prominently since it's a two-layer design where the two layers currently
authorize at different granularity, and the RLS layer is quietly doing more
of the real work than the code alone suggests.

## Content publishing

No changes to Session 04's lifecycle. Publishing a module/lesson through
this UI calls the exact same `publishModule()`/`publishLesson()` that
snapshot a `LessonVersion` and flip `status` — visible to enrolled students
immediately, no separate review step (per
`PLATFORM_ARCHITECTURE.md` §7's allowance, already exercised by Session 04).
"Push approved notes/modules/resources to student-visible space" from the
session brief's "Required behavior" list **is** this publish action —
there is no separate "push" mechanism to build.

## Cohort progress — what's real, what isn't

The course detail page's "Cohorts & roster" section shows real data:
per-cohort enrollment roster and status counts (active/completed/withdrawn)
via `listEnrollmentsForCohort()`. This is **not** lesson-level completion,
mastery, or any derived learning signal — those require the `Progress`
model that Session 08 (Progress & Adaptive Learning) owns and has not been
built yet. This session deliberately did not compute anything
mastery-adjacent from raw enrollment/content data, per the session brief's
"Must NOT: calculate mastery independently from Progress service." Session
08 should consume `Enrollment`/`LessonVersion` directly rather than this
page's presentation-only aggregation.

## Blockers (dependencies on sessions that don't exist yet)

Both are reported BLOCKED per `CLAUDE_BUILD_RULES.md` §2 — a wired entry
point exists (nav item + page), but no parallel system was built to fake
the capability.

**Messaging** (`/messages`, Session 09): expected contract — a
`Conversation` with a participant list and a `type`
(`"direct" | "group" | "cohort_broadcast"`), e.g.
`startConversation({ participantIds, type, contextCohortId? }, actor)` /
`sendMessage(conversationId, body, actor)`, server-side participant
authorization, emitting `MessageReceived` (already typed in
`src/lib/events.ts`'s `DomainEventMap` since Session 01) for Notifications
to pick up. Teacher's required use cases (individual student / selected
group / whole cohort) are exactly `sessions/09-messaging.md`'s list.

**Assessment authoring** (`/assessments`, Session 07): expected contract —
`createAssessment(courseId, input, actor)` /
`publishAssessment(assessmentId, actor)` etc., ownership-scoped the same
way as `createModule()`/`publishModule()` (`courses.content.write`/
`courses.content.publish` + `cohort_teachers`), reusing `Topic`/
`LessonTopic` for question tagging rather than a parallel taxonomy (per
Session 04's handoff to Session 07).

## Permissions

**Updated by Session 45**: `TEACHER` now also holds
`courses.create.organization`, which lets a teacher create a course scoped
to an organization they are an ACTIVE member of — never a platform-wide
one, and never another organization's. See
`docs/ORGANIZATION_CORE.md`'s "Teacher org-scoped course creation" for the
full contract and why it is a separate key from `courses.create`. The
teacher workspace's `/courses` page carries the form; the course is not
teachable until an admin attaches a cohort and assigns the teacher to it
(unchanged — `courses.manage` still owns cohorts).

Otherwise unchanged from Session 05: reuses Session 04's
`courses.content.write`/`courses.content.publish` (both already default to
`TEACHER`) for every authoring action, and Session 02's self-ownership pattern
(`requireOwnResourceOrPermission`) for profile edits. `TEACHER_PORTAL_ROLES`
(`src/lib/authz.ts`) is a new *role list*, not a new permission — same
shape as `ADMIN_CONSOLE_ROLES`.

## Events

None new. No mutation in this session's scope crosses a module boundary
that isn't already covered by Session 04's `CoursePublished`/
`StudentEnrolled` (neither of which this session's screens trigger —
course-level publish and enrollment are Admin-owned actions, not exposed
here).

## Tests

- `src/lib/authz.test.ts` — `canAccessTeacherPortal()` positive/negative.
- `src/lib/teacher-workspace.test.ts` — `listMyCourses()` scoping
  (empty-but-not-error for an unassigned teacher, own-courses-only,
  negative case for a STUDENT calling it at all), `getCourseById()`
  rejecting an outsider teacher, and an explicit "student cannot fetch
  unpublished material" case exercised through the same
  `getCourseContentForStudent()` path this session's publish actions feed
  into.
- `src/lib/teacher-cohort-rls.integration.test.ts` — the cohort-vs-course
  RLS granularity proof described above, against the real
  `portal_rls_test` role. Skips (doesn't fail) if `RLS_TEST_DATABASE_URL`
  is unset, same convention as every other `*.integration.test.ts` in this
  repo.
- `src/lib/users.test.ts` gained `getOwnProfile()` coverage (self-read
  without `users.read`, reflects a just-applied update, cannot be
  parameterized to read someone else's row).
- 148/148 passing (`npm test`, including all `*.integration.test.ts` — set
  up `portal_rls_test` locally per `scripts/dev/create-rls-test-role.sql`
  and ran them for real this session).

### Live verification (real running dev server, not just tests)

Logged in as a real `TEACHER` via an actual
`POST /auth/callback/credentials` request (Host header
`teacher.<ROOT_DOMAIN>`, real CSRF token + session cookie — same technique
Session 02 used to prove revocation live). Then, since this session's forms
are plain (unbound-argument) `<form action={fn}>` Server Actions, curl can
replicate them exactly: each rendered form is genuinely a
`multipart/form-data` POST to the current URL carrying one empty-valued
`$ACTION_ID_<hash>` field alongside the normal named inputs — no browser
required. Verified against real DB rows, not just HTTP status codes:
- Created a module and a lesson through the real "New module"/"New lesson"
  forms; confirmed both persisted (draft) on next page load.
- Published both through the real "Publish" buttons; confirmed
  `status: "published"` and a `LessonVersion` snapshot via a fresh page
  load.
- **Negative authorization, live**: logged in as a second `TEACHER` never
  assigned to the course. `GET /courses/[id]` rendered "not assigned to
  teach this course" (no draft content leaked into the page). A **crafted**
  `POST` replaying the exact `createModuleAction` request shape (same
  action id, a courseId the outsider was never assigned to) was rejected
  server-side (`303 → ?error=not_authorized`); confirmed via the
  authorized teacher's own subsequent page load that no "Sneaky Module" row
  was ever created — the UI hiding the form was never the only thing
  stopping it.
- A `STUDENT` logging in at the teacher subdomain is bounced back to
  `/login` by the layout guard after landing on `/dashboard` once (same
  pattern as the admin console's non-admin case).
- `/messages` and `/assessments` render their BLOCKED banners live.
- Found and fixed the `getOwnProfile`/stale-JWT-name bug described above by
  submitting the real profile-update form twice and observing the DB row
  update correctly while the re-rendered page initially still showed the
  old name — see "What this session built vs. reused" above for the fix.
- All smoke-test users/course data created for this verification were
  cleaned up afterward (verified zero `live-verify-%` rows remain).

## Known limitations

- No module/lesson content-review step before a teacher's publish action
  goes live — unchanged from Session 04's documented, deliberate choice.
- Move-up/move-down reordering re-fetches the full course content tree and
  writes one `UPDATE` per item in a transaction (via the existing
  `reorderModules`/`reorderLessons`) — fine at foundation scale, same
  caveat Session 04's handoff already carried forward.
- Cohort/enrollment application-layer authorization is course-scoped while
  RLS is cohort-scoped (see "Cohort/course visibility" above) — not fixed
  here since `courses.ts` belongs to Session 04's boundary; flagging for
  whoever next touches that ownership model, since RLS quietly carries more
  of the real enforcement weight than the application code alone implies.
- Teacher cannot create new `Topic` rows (requires `topics.manage`, an
  admin-only permission by design) — can only tag/untag existing topics.
  Matches Session 04's stated ownership split.
- No file upload for `Resource` — still URL-only, per Session 04/01's
  already-documented, unresolved storage/asset-abstraction gap (Session
  13's scope).

## Blockers carried into next sessions

- **Session 07 (Assessment)**: `/assessments` is a real, working entry
  point with no backing capability. Build `createAssessment`/
  `publishAssessment`/etc. and this page should link out to it — no schema
  or permission changes anticipated on the Teacher side.
- **Session 09 (Messaging)**: `/messages` is the same — a real entry point,
  no backing capability. See "Blockers" above for the exact expected
  contract shape.
- **Session 08 (Progress & Adaptive Learning)**: the "Cohorts & roster"
  section's enrollment-status counts are a stopgap. Once `Progress` exists,
  it should likely replace (or supplement) this section rather than this
  session's presentation-only aggregation growing further in place.
