# Reporting & Impact (Session 12)

Turns existing platform activity into operational and sponsor-impact
reporting. Built entirely as read-time aggregation over Education Core
(Session 04), Assessment (Session 07), Progress (Session 08), and Sponsor
Core (Session 11) — **zero new tables, zero new permission keys, zero
migrations**. Nothing here is a separate analytics database; every number is
computed fresh from the same canonical rows every other module already
reads and writes.

## What this session owns

- Admin operational reports: course completion, assessment outcomes,
  participation — platform-wide, with course + date-range filtering.
- Teacher cohort assessment-outcomes report (fills the gap Session 08's
  topic-mastery cohort view deliberately left: per-assessment score/pass
  rate, not topic accuracy).
- Sponsor project reports: milestone status/overdue report, a date-filtered
  project-metric time series (wraps Session 11's existing
  `getProjectImpactSummary`/`listProjectMetrics`), and an aggregate-only
  beneficiary engagement summary.
- The export/report-generation contract: a shared `toCsv()` serializer plus
  the Route Handler convention every CSV download here follows.

## Data model

**No schema changes.** Every function in `src/lib/reporting.ts` reads
`Enrollment`, `LessonProgress`, `Attempt`/`Answer`, `Milestone`,
`ProjectMetric`, and `ProjectMembership` — all pre-existing. See
`PLATFORM_DATA_MODEL.md`'s ownership matrix; this session introduces no new
row in it.

## Authorization

No new permission keys — every report reuses an existing gate exactly as-is:

| Report | Gate | Source |
|---|---|---|
| Admin completion / assessment outcomes / participation | `courses.manage` or `super_admin` | new `requireAdminReporting()` helper in `reporting.ts`, same rule `courses.ts`'s `listCourses()`/`admin-stats.ts`'s `getSystemStatus()` already use |
| Teacher cohort assessment outcomes | `assertCanManageOrTeachCourse()` | `courses.ts`, reused verbatim (same gate `progress.ts`'s cohort reports use) |
| Sponsor milestone report / metrics report | `requireProjectSponsorAccess()` | `sponsor.ts`, reused verbatim (delegated through `listMilestonesForProject`/`listProjectMetrics`/`getProjectImpactSummary`) |
| Sponsor beneficiary engagement summary | `requireProjectSponsorAccess()` explicitly, then an elevated read scoped to already-confirmed beneficiary ids | see "Privacy" below |

## Privacy — "Must NOT expose raw private student notes/messages in sponsor reports"

This module never queries `student_notes`, `bookmarks`, `conversations`, or
`messages` — no report anywhere in this session touches those tables, full
stop.

`getBeneficiaryEngagementSummary()` is the one sponsor-facing function that
reads Education Core data keyed by student identity. It:

1. Calls `requireProjectSponsorAccess(projectId, actor)` **first** — the
   caller must already be authorized for this specific project.
2. Only then reads `Enrollment`/`Lesson`/`LessonProgress`/`Attempt` under an
   elevated context, scoped to exactly the beneficiary user ids already
   confirmed to belong to this project (a plain `SPONSOR_ADMIN`/
   `SPONSOR_USER` actor has **no** RLS visibility into those tables at all —
   self-or-teacher-or-`courses.manage` only, see the `education_core`/
   `progress_lesson_completion`/`assessment_core` migrations).
3. Returns **rounded counts and percentages only** — `beneficiaryCount`,
   `withEnrollmentCount`, `avgCompletionPercent`, `assessmentsAttempted`,
   `assessmentsPassed`, `passRatePercent`. Never a per-student row, name,
   score, note, or message.

This mirrors `sponsor.ts`'s `listProjectBeneficiaries()`/
`getProjectBeneficiaryCount()` privacy shape exactly (documented in that
file's own header) — the same "ownership check first, minimal elevated read
second, never leak the underlying identity" pattern, applied to Education
Core instead of `users`.

**Known limitation**: Sponsor Core has no `Project<->Course` link today, so
`getBeneficiaryEngagementSummary()` is a **platform-wide** aggregate over
each beneficiary's own enrollments — not scoped to "courses this project
specifically funds." If a future session adds that link, this function
should be narrowed to use it. Flagged here rather than invented unilaterally
(`CLAUDE_BUILD_RULES.md` §2).

## Metric definitions

All filters accept an optional `{ from?, to? }` date range (inclusive) and
an optional `courseId`/`assessmentId` narrowing, where noted. All
percentages are rounded to the nearest integer.

### Admin: Course completion (`getAdminCompletionReport`)

- Scope: every `Enrollment` whose `enrolledAt` falls in the window (default:
  all time), optionally narrowed to one course.
- `completed` = count where `Enrollment.status === 'completed'` — Session
  08's real, evidence-driven, reversible completion flag. Never re-derived.
- `completionRatePercent` = `completed / enrollments` per course, and across
  the whole filtered set for `totals`.

### Admin: Assessment outcomes (`getAdminAssessmentOutcomesReport`)

- Scope: every `Attempt` with `status IN (submitted, graded)` whose
  `submittedAt` falls in the window, optionally narrowed by course or
  assessment.
- `avgScorePercent`/`passRatePercent` are computed **only over graded
  attempts** (`scorePercent`/`passed` are `null` until Session 07's grading
  finishes — a pending manual-grade attempt still counts toward `attempts`,
  never toward the score/pass averages).
- `passRatePercent` further excludes attempts where `passed` is `null`
  (i.e. the assessment has no `passingScorePercent` configured) from its
  denominator.

### Admin: Participation (`getAdminParticipationReport`)

- "Participation" = a student took a real, recorded learning action in the
  window: a lesson marked complete (`LessonProgress.completedAt`) OR an
  assessment attempt submitted (`Attempt.submittedAt`).
- `activeStudents` is a **count of distinct students**, never a roster —
  this is a count-only operational view by design.

### Teacher: Cohort assessment outcomes (`getAssessmentOutcomesForCohort`)

Identical formula to the admin assessment-outcomes report, scoped to one
cohort's currently-enrolled students on that cohort's own course.

### Sponsor: Milestone report (`getMilestoneReport`)

- One row per `Milestone`, bucketed by `status`
  (`planned`/`in_progress`/`achieved`/`missed`).
- `overdue` = `status` is neither `achieved` nor `missed`, AND `targetDate`
  is set and in the past. A milestone marked `missed` is not double-counted
  as `overdue` — that status transition is the explicit "we know it's late"
  signal (set via `updateMilestone`), `overdue` is the *implicit*, not-yet-
  acknowledged case.

### Sponsor: Project metrics report (`getProjectMetricsReport`)

- `summary`: unchanged pass-through of Session 11's
  `getProjectImpactSummary()` — latest sample per label + how many samples
  exist.
- `series`: every `ProjectMetric` row for the project whose `recordedAt`
  falls in the window — the underlying time series a chart or CSV export
  can consume, filtered but otherwise unmodified.

### Sponsor: Beneficiary engagement summary (`getBeneficiaryEngagementSummary`)

See "Privacy" above for the authorization/elevation shape. Definitions:

- `withEnrollmentCount`: distinct beneficiaries with at least one
  `active`/`completed` enrollment, platform-wide.
- `avgCompletionPercent`: for every (beneficiary, course) enrollment pair,
  `completedLessons / publishedLessons` for that course; averaged across all
  such pairs. A course with zero published lessons is excluded from the
  average (undefined ratio), not treated as 0%.
- `assessmentsAttempted`/`assessmentsPassed`/`passRatePercent`: over every
  `graded` `Attempt` any beneficiary has made, platform-wide — same
  graded-only, `passed IS NOT NULL`-only rule as the admin assessment
  outcomes report.

## Export / report generation contract

`toCsv<T>(rows: T[], columns: { key: keyof T; header: string }[]): string`
in `src/lib/reporting.ts` — every flat report-row interface above
(`CourseCompletionRow`, `AssessmentOutcomeRow`, `CourseParticipationRow`,
`MilestoneReportRow`, `ProjectMetricsReport.series` entries, ...) serializes
through this one function. A future export format (PDF/XLSX) or a future
report type should implement against this same `{key, header}[]` shape
rather than inventing a parallel formatter.

Route Handlers consuming it (all under each portal's own subdomain, since
Route Handlers are **not** wrapped by their segment's `layout.tsx` guard —
same convention Session 13's asset downloads established, so each one
re-checks auth itself):

- `GET /admin/reports/completion/export`
- `GET /admin/reports/assessment-outcomes/export`
- `GET /admin/reports/participation/export`
- `GET /sponsor/projects/[id]/report/export` (the project's milestone
  report)

Each accepts the same `courseId`/`from`/`to` query params as its page and
returns `text/csv` with a `Content-Disposition: attachment` header.

## UI

- `/admin/reports` — new page (new "Reports" nav entry, gated on
  `courses.manage`): three filterable sections (course + date-range form),
  each with a CSV download link.
- `/teacher/courses/[id]` — each cohort card gained an "Assessment outcomes"
  disclosure (same pattern as the existing "Topic performance" disclosure),
  next to Session 08's completion/topic-mastery views.
- `/sponsor/projects/[id]` — the Milestones section gained a status-summary
  strip (achieved/in-progress/planned/missed/overdue counts) and a
  "Download report (CSV)" link; a new "Beneficiary engagement" section
  (aggregate tiles only, explicitly labeled as platform-wide and
  aggregate-only in the UI copy itself).

## Permissions

**None added.** See the Authorization table above.

## Events

**None emitted or newly consumed.** This module is pure read — it reacts to
nothing and triggers nothing. (If a future session wants a scheduled/
emailed report, that would consume these same functions from a new
job/notification trigger, not duplicate the aggregation logic here.)

## Tests

`src/lib/reporting.test.ts` — 15 tests, all integration-style against the
real dev Postgres (matching every other `*.test.ts` in this repo):

- Admin completion/assessment-outcomes/participation: correct aggregation,
  date-range filtering excludes out-of-window attempts,
  `courses.manage`/`super_admin`-only authorization boundary.
- Teacher cohort assessment outcomes: correct aggregation, ownership
  boundary (an outsider teacher is rejected).
- Sponsor milestone report: status bucketing, overdue detection (including
  that `achieved`/`missed` are never also flagged `overdue`), authorization
  boundary (a sponsor with no project-team membership is rejected).
- Sponsor project metrics report: date-range filtering of the series while
  the summary stays the latest-per-label rollup.
- Sponsor beneficiary engagement summary: correct aggregate counts over a
  real enrolled/completed/attempted beneficiary, the zero-beneficiary
  no-error case, authorization boundary, and an explicit assertion that the
  returned object carries no `students`/`beneficiaries` key.
- `toCsv()`: header/row serialization, comma/quote escaping, null/undefined
  handling — pure unit tests.

`npm test`: **369/369 passing** (up from 354). `npx tsc --noEmit` and
`npm run build` both pass.

## Known limitations

- `getBeneficiaryEngagementSummary()` is platform-wide, not
  project/course-scoped — see "Privacy" above. This is the one place this
  session's numbers could read as more precise than they are if presented
  without the UI's explicit "platform-wide" caveat (which is included).
- No PDF/XLSX export — only CSV. `toCsv()`'s contract is format-agnostic in
  spirit (see "Export contract" above) but only one serializer is
  implemented.
- No scheduled/emailed report delivery — every report here is generated
  on-demand when a page/export route is hit, matching this session's "pure
  read, no new background jobs" scope.
- Admin reports are platform-wide by design (no cohort-level admin view) —
  an admin wanting cohort granularity uses the same
  `getCourseProgressForCohort`/`getTopicMasteryForCohort`/
  `getAssessmentOutcomesForCohort` a teacher would, via impersonation/
  super-admin access to `/teacher/courses/[id]`, not a duplicated admin-side
  cohort report.

## Blockers

None. Everything in this session's scope was buildable without any
external dependency or another module's missing capability.

## Required next-session actions

- **Whoever adds a `Project<->Course` link to Sponsor Core** (if ever):
  narrow `getBeneficiaryEngagementSummary()` to that link instead of the
  current platform-wide aggregate — see this doc's "Known limitation."
- **Session 14 (Certificates)**: if certificate-issuance reporting is
  wanted, build it as a new read over `Certificate` (once that table
  exists) following this session's same read-only, no-new-analytics-store
  pattern — not a duplicated aggregation mechanism.
- **Whoever wants scheduled/emailed sponsor reports**: consume
  `getMilestoneReport()`/`getProjectMetricsReport()`/
  `getBeneficiaryEngagementSummary()` directly from a new job/notification
  trigger; do not re-derive the aggregation logic.
