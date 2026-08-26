# Progress & Adaptive Learning (Session 08)

Turns learning activity and assessment data into trustworthy progress and
mastery signals. Built entirely on top of Education Core (Session 04) and
Assessment (Session 07) — no parallel course model, no parallel analytics
database, no re-derivation of what "published"/"enrolled"/"graded" already
mean elsewhere in the app.

Core model: **Student activity -> evidence -> progress/mastery -> views.**

## What this session owns

- Lesson/module/course completion tracking (`LessonProgress`,
  `Enrollment.completedAt`/`status`).
- Topic/skill mastery calculation, read-time only — no stored/cached
  snapshot.
- Student-facing progress + strengths/weak-areas view (`/student/progress`).
- Teacher-facing cohort progress + topic performance analytics
  (`/teacher/courses/[id]`'s "Cohorts & roster" section).
- A rule-based "recommended focus areas" seam for future adaptive/AI
  features (`getRecommendedFocusAreas`).

## Data model addition

One new table: `LessonProgress` (migration
`20260826212018_progress_lesson_completion`). A student's explicit "I
completed this lesson" evidence record — deliberately not a page-view/
time-on-page heuristic, and deliberately has no "in_progress" state (a
row's mere existence is the complete signal). Append-only, same shape as
`lesson_versions`/`assessment_versions`/`audit_events`: **no UPDATE or
DELETE RLS policy at all, for any role including super_admin.** `courseId`
is denormalized from `lesson.courseId`, the same pattern `Lesson.courseId`
itself uses.

No other new tables. Topic mastery is computed fresh on every read from
`Attempt`/`Answer`/`QuestionTopic` (Session 07) and `LessonProgress`/
`LessonTopic` (this session + Session 04) — there is nothing to cache or
let drift out of sync with the underlying evidence, and nothing here
re-grades an answer or re-derives publish/enrollment state.

## Event model

- **`LessonCompleted`** (`{ lessonId, studentId, courseId }`) — first real
  emitter, from `markLessonComplete()`. The `courseId` field was added to
  the payload this session (it was pre-typed since Session 01 without it);
  additive, since nothing emitted this event before.
- `markLessonComplete()` **awaits** `recalculateCourseProgress()` directly
  after emitting, so a caller sees fully consistent `Enrollment` state the
  moment the function returns — no fire-and-forget race. That same
  function is *also* registered as this module's own
  `onDomainEvent("LessonCompleted", ...)` listener, satisfying
  `PLATFORM_ARCHITECTURE.md` §9's "subscribe to events" convention for any
  future code path that might record a completion without going through
  `markLessonComplete()`. Recalculation is a pure, idempotent function of
  current DB state, so the listener's redundant re-run on the same call is
  harmless.
- **`AssessmentGraded`** (Session 07) is deliberately **not** subscribed to
  here: topic mastery is computed live from `Attempt`/`Answer` on every
  read, so there is no cached state for that event to invalidate.

## Enrollment.completedAt/status — writing another module's reserved field

`Enrollment` is Education Core's (Session 04) table, but Session 04's own
handoff explicitly reserved `completedAt` for this session to fill in
("needs a Progress model to drive completion"). Writing it requires
`courses.manage` under `enrollments_update`'s existing RLS policy — a
`STUDENT` actor cannot update their own enrollment row directly, by
design. Rather than a blanket `super_admin` bypass,
`recalculateCourseProgress()` runs under a synthesized RLS context holding
**only** `courses.manage` (the same least-privilege "system context" shape
Session 02 established for `revokeAllUserSessionsAsSystem()`). This is
deliberately not exported for general use — every caller must have already
authorized touching the specific `(courseId, studentUserId)` pair.

Recalculation is **fully reversible**: if a teacher publishes a new lesson
after a student had already completed everything, the next recalculation
correctly moves `status` back from `completed` to `active`. Covered by a
regression test (`src/lib/progress.test.ts`, "reverts a completed
enrollment back to active when new content is published afterward").

## Mastery calculation (v1 — deliberately simple, evolvable)

Per the session brief ("do not start with a giant AI system — first
establish reliable structured educational data"). Evidence sources, in
priority order:

1. **Graded assessment answers** (`Attempt.status='graded'`, joined
   `Question -> QuestionTopic -> Topic`) — the strongest signal, a real
   correct/incorrect verdict Session 07 already computed. Never re-graded,
   only read. Accuracy ≥75% → `strong`; ≥50% → `developing`; below 50% →
   `weak`.
2. **Completed-lesson exposure** (`LessonProgress -> Lesson -> LessonTopic`)
   — a weaker, un-scored "the student engaged with this topic's content"
   signal, used only when NO assessment evidence exists yet for that topic
   (`masteryLevel: "exposure_only"` — never classified weak/strong, since
   there's no correctness signal to base that on).

`src/lib/progress.ts`'s `aggregateTopicMastery()` is the pure function
implementing this (exported and directly unit-tested for the threshold
boundaries) — the calculation is isolated from the DB query so it can
evolve independently later.

## APIs/contracts

`src/lib/progress.ts`:

- `markLessonComplete(courseId, lessonId, actor)` — self-scoped, idempotent.
- `recalculateCourseProgress(courseId, studentUserId)` — internal system
  function (see above); exported for tests and the event listener only.
- `getCourseProgressForStudent(courseId, actor)` — self-scoped, per-module/
  lesson completion breakdown.
- `getCourseProgressForCohort(cohortId, actor)` — teacher-facing, requires
  `courses.manage`/`super_admin`/being a teacher on the cohort's course
  (reuses `courses.ts`'s `assertCanManageOrTeachCourse`, now exported for
  this purpose).
- `getTopicMasteryForStudent(actor, { courseId? })`,
  `getWeakStrongTopicsForStudent(actor, { courseId? })` — self-scoped.
- `getTopicMasteryForCohort(cohortId, actor)` — teacher-facing cohort-level
  topic performance, same ownership gate as the progress report.
- `getRecommendedFocusAreas(actor, { courseId?, limit? })` — the
  future-ready seam (see below).
- `aggregateTopicMastery(answers, lessonProgress)` — pure, exported for
  unit testing.

## Recommendations contract (future-ready seam)

`getRecommendedFocusAreas()` returns a student's weakest-evidenced topics,
worst first. **Deliberately rule-based, not AI** — per this session's "Must
NOT let AI become the source of truth for raw educational evidence," any
future personalized-study-plan/adaptive-practice/AI-tutoring/UTME-prep
system should sit **on top of** this function's real, structured evidence
(or call it directly), never replace it.

## Permissions

**No new permission keys.** Student-side reads/writes are self-scoped (no
permission required beyond self-scoping, mirroring `listMyResults()`).
Teacher-side reads reuse the exact `assertCanManageOrTeachCourse` ownership
check `courses.ts`'s `getCourseById`/`listCohortsForCourse`/
`listEnrollmentsForCohort` already use — now exported for this session to
reuse rather than duplicating a fourth copy of the same check.

## RLS

`lesson_progress_select`: self, OR teacher-of-course (via
`cohort_teachers`), OR `courses.manage`/`super_admin`.
`lesson_progress_write`: self only (`student_user_id = app.user_id`) —
proved against the real non-superuser `portal_rls_test` role that a
student cannot forge a completion for another student.
**No UPDATE/DELETE policy at all** — proved that neither `super_admin` nor
a `courses.manage` holder can alter or remove a recorded completion.

## UI

- `/student/progress` — real per-course completion bar + per-lesson
  checklist (via `getCourseProgressForStudent`) and a strengths/weak-areas
  section (via `getTopicMasteryForStudent`), replacing Session 06's
  deliberately-minimal enrollment-status-only stub.
- `/student/courses/[courseId]/lessons/[lessonId]` — a "Mark complete"
  button (hidden once already completed, replaced with a disabled "✓
  Completed" indicator).
- `/teacher/courses/[id]` — the "Cohorts & roster" table now shows each
  student's real lesson-completion count/percentage (was enrollment-status
  only), plus a "Topic performance" disclosure per cohort showing cohort
  accuracy and weak/strong student counts per topic.
- `StatusBadge` gained `weak`/`developing`/`strong`/`exposure_only` tones
  (additive, same shape as every prior session's badge-tone addition).

## Verification

- `npm test` — **242/242 passing** (up from 218): 19 new in
  `src/lib/progress.test.ts` (completion, idempotency, the reversible
  recalculation regression case, mastery classification thresholds, cohort
  aggregation, ownership boundaries) + 5 new in
  `src/lib/progress-rls.integration.test.ts` (run for real against the
  non-superuser `portal_rls_test` role — self/teacher/outsider visibility,
  forged-completion rejection, append-only enforcement against both
  `super_admin` and `courses.manage`).
- `npx tsc --noEmit` and `npm run build` both pass.
- **Live E2E verification against a real running dev server**: seeded a
  real course/cohort/teacher/student/two-published-lessons/topic/tagged-
  question/published-assigned-assessment via the public
  `courses.ts`/`content.ts`/`topics.ts`/`questions.ts`/`assessments.ts`
  API, logged in as a real `TEACHER` and `STUDENT` via actual
  `POST /auth/callback/credentials` requests, and drove the flow through
  real, rendered Server Actions (the same multipart `$ACTION_ID_*`
  replication technique every prior session in this repo has used since no
  browser-automation tool was available): marked lesson A complete (50%,
  confirmed in Postgres), marked lesson B complete (100%, confirmed
  `Enrollment.status` flipped to `completed` in Postgres as a direct side
  effect), took the assessment and answered correctly (auto-graded 100%),
  confirmed `/student/progress` showed the topic as "Strong," and
  confirmed `/teacher/courses/[id]` showed "2/2 (100%)" for that student
  and the same topic in its "Topic performance" table. All smoke-test data
  (3 users, 1 course + full cascade, 1 topic) cleaned up afterward,
  verified zero rows remain.

## Known limitations

- A mistakenly-marked-complete lesson cannot be un-marked — `LessonProgress`
  has no UPDATE/DELETE policy at all, by design (append-only evidence, per
  `CLAUDE_BUILD_RULES.md` §4's "never casually delete historical records").
  If this becomes a real product need, it should be a new explicit
  lifecycle state (e.g. a `revokedAt` column with its own narrow RLS
  branch), not a relaxation of the existing append-only guarantee.
- `getCourseProgressForCohort`/`getTopicMasteryForCohort` run one query set
  per cohort — fine at foundation scale, revisit if a cohort's enrollment
  count grows large.
- No `timeLimitMinutes`-style background job exists to auto-mark a lesson
  complete or auto-expire progress — everything here is driven by explicit
  student action or graded assessment results, never a scheduled job.
- No admin-level cross-cohort/cross-course progress dashboard — this
  session's teacher-facing reads are scoped to one cohort at a time,
  matching the existing `listCohortsForCourse`/`listEnrollmentsForCohort`
  granularity. A rollup view belongs to Session 12 (Reporting & Impact) if
  wanted.
- `getRecommendedFocusAreas()` is capped at `limit` (default 5) and sorted
  by accuracy only — no recency weighting, no spaced-repetition logic. This
  is intentional for v1; the docstring on the function names it as the seam
  for whichever future session builds real adaptive scheduling.

## Blockers

None. Everything in this session's scope was buildable without any
external dependency or another module's missing capability.

## Required next-session actions

- **Whoever builds personalized study plans / adaptive practice / AI
  tutoring / the UTME prep engine**: call `getRecommendedFocusAreas()` (or
  the lower-level `getTopicMasteryForStudent()`) rather than re-deriving
  mastery from raw `Attempt`/`Answer` data — that duplication is exactly
  what this session's "Must NOT" list warns against.
- **Session 09 (Messaging)** / **Session 10 (Notifications)**: a
  lesson-completion or course-completion event could be a natural
  notification trigger (`LessonCompleted` is already emitted) — not wired
  here, out of this session's boundary.
- **Session 12 (Reporting & Impact)**: if a cross-cohort/cross-course
  progress rollup is wanted, build it as a new read over
  `getCourseProgressForCohort`/`getTopicMasteryForCohort`'s same
  underlying evidence, not a new aggregation table.
- **Session 14 (Certificates)**: `Enrollment.status === "completed"` is now
  a real, driven-by-evidence signal for the first time — a natural
  certificate-issuance trigger to consider, not wired here.
