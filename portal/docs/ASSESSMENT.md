# Assessment (Session 07)

One shared assessment engine, consumed by both the Teacher and Student
workspaces — not two separate quiz systems. Built on top of Session 04's
Education Core (Course/Cohort/Enrollment, never redefined) and reuses
Session 04's `Topic` taxonomy for `Question` tagging, per that session's
handoff.

## Core relationship

```
Course -> Question (bank)
Course -> Assessment -> AssessmentQuestion -> Question   (live, editable)
                      -> AssessmentVersion                (immutable snapshot, one per publish)
                      -> AssessmentAssignment -> Cohort | Student
Assessment -> Attempt -> AssessmentVersion (pinned, never the live Assessment)
           -> Attempt -> Answer -> Question
```

Ownership is scoped exactly like Module/Lesson (`src/lib/courses.ts`'s
`requireCourseContentAccess()`/`isCourseTeacher()`): a `TEACHER` holder must
also be a `cohort_teachers` row for a cohort of the assessment's course. **No
new permission keys** — every teacher-side mutation reuses
`courses.content.write` (authoring: questions, assessment metadata, grading)
or `courses.content.publish` (publish, assign) exactly as Session 05's
handoff to this session specified.

## Workflow

```
Teacher creates -> Draft -> Publish -> Assign -> Student Attempt -> Submit -> Grade -> Results
```

- **Create**: `createAssessment(courseId, input, actor)` — draft, `version: 0`.
- **Author questions**: `createQuestion(courseId, input, actor)` (the bank,
  reusable across assessments) + `addQuestionToAssessment(assessmentId,
  questionId, {points}, actor)` (the live, editable link).
- **Publish**: `publishAssessment(assessmentId, actor)` — snapshots the
  entire question/option/correct-answer tree into a new immutable
  `AssessmentVersion` row, bumps `Assessment.version`, requires ≥1 question.
- **Assign**: `assignAssessmentToCohort()` / `assignAssessmentToStudent()` —
  requires the assessment to already be published.
- **Attempt**: `startAttempt(assessmentId, actor)` — idempotent (resumes an
  existing `in_progress` attempt), enforces `maxAttempts`, and requires the
  student to actually be reached by an assignment (cohort or direct). Every
  `Attempt` is permanently bound to the specific `AssessmentVersion` that was
  current when it started — never the live `Assessment`/`Question` rows.
- **Submit**: `submitAttempt(attemptId, answers, actor)` — auto-grades
  `single_choice`/`multiple_choice` against the version's frozen answer key,
  and `short_answer` against `acceptableAnswers` (case-insensitive exact
  match) when configured. A `short_answer` question with no match and no
  configured `acceptableAnswers` is left pending (`isCorrect: null`) for
  manual grading. If every question ends up graded in the same call, the
  attempt finalizes to `status: "graded"` immediately.
- **Grade**: `gradeAttempt(attemptId, grades, actor)` — teacher-only,
  ownership-scoped, fills in pending answers; the attempt finalizes to
  `graded` (computing `scorePoints`/`maxPoints`/`scorePercent`/`passed`) only
  once every question has a non-null `isCorrect`. Callable incrementally.
- **Results**: `listMyResults(actor)` (student, self-scoped) /
  `listAttemptsForAssessment(assessmentId, actor)` (teacher, ownership-scoped).

## Why historical attempts can never be rewritten

This was the session's explicit "Must NOT" — the mechanism, exactly mirroring
`LessonVersion`'s established pattern:

1. `publishAssessment()` denormalizes the **full** question tree (prompt,
   options, `isCorrect`, `acceptableAnswers`, points, order) into
   `AssessmentVersion.questions` (`Json`) at the moment of publish.
2. `AssessmentVersion` is append-only at the RLS layer — no `UPDATE`/`DELETE`
   policy exists at all, for any role including `super_admin` (proved in
   `src/lib/assessment-rls.integration.test.ts`).
3. Every `Attempt` stores `assessmentVersionId`, not `assessmentId` alone.
   `startAttempt()`/`submitAttempt()`/`gradeAttempt()` always read the
   snapshot off that pinned version — never the live `Assessment`/`Question`/
   `QuestionOption` rows.
4. Editing the live question bank or an assessment's question list after
   publishing therefore has **zero effect** on any attempt already in
   progress or completed. Re-publishing creates a brand-new
   `AssessmentVersion` (`version + 1`); the previous one is untouched.
   Proved directly in `src/lib/assessments.test.ts`
   ("editing the live question list after publishing does NOT rewrite the
   earlier version").

## Answer-key redaction is an application-layer concern, not RLS

RLS is a **row-level** backstop (documented limitation since Session 02's
handoff), not column-level. A student who owns an `Attempt` against a given
`AssessmentVersion` is legitimately permitted to `SELECT` that row at the DB
layer (they need the prompts/options to take the assessment, and the
explanations/correct answers to view results afterward) — so the answer key
embedded in `AssessmentVersion.questions`' JSON cannot be hidden by a
row-level policy alone.

Redaction happens in `src/lib/attempts.ts`'s `buildAttemptView()`: for a
student, a question's `isCorrect`/`option.isCorrect`/`acceptableAnswers`/
`explanation` are included **only once that specific question has been
graded** (`answer.isCorrect !== null`) — regardless of whether the overall
attempt has finished grading (a mixed assessment with one pending
short-answer question still reveals the already-auto-graded multiple-choice
questions). A teacher's view (`getAttemptForTeacher()`) always reveals
everything, needed to grade.

The **bank tables themselves** (`questions`/`question_options`/
`question_topics`) go further: their RLS policies have **no student SELECT
branch at all** — a student can never query them directly under any
circumstance, only ever read the frozen, redacted snapshot through their own
attempt. This is defense-in-depth on top of the application-layer redaction,
proved in `assessment-rls.integration.test.ts`.

## A real RLS bug found and fixed while authoring this migration

`assessments_select`'s "is this published assessment assigned to me"
student-visibility branch queries `assessment_assignments`.
`assessment_assignments_select`'s teacher-ownership branch originally
resolved the assessment's course via a join back through the `assessments`
table. Postgres applies a referenced table's **own** RLS policies to any
table access inside a policy expression — so those two policies referenced
each other, and Postgres raised `"infinite recursion detected in policy for
relation assessments"` against the real `portal_rls_test` role (not a
theoretical concern — reproduced and confirmed live).

Fixed by denormalizing `courseId` directly onto `AssessmentAssignment`
(exactly the same reasoning as `Lesson.courseId`'s existing denormalization
comment) so `assessment_assignments`'s own policies never need to read back
through `assessments`. Documented prominently in the migration SQL for
whoever next writes an RLS policy with a cross-table subquery — this is the
second real `CREATE POLICY` gotcha found in this repo (the first,
"ambiguous bare column reference inside a correlated EXISTS," is in the
education_core migration).

## Question types and grading

- `single_choice` — exactly one `QuestionOption.isCorrect`. Auto-graded:
  the student's selected set must equal the correct set exactly.
- `multiple_choice` — one or more correct options. Same set-equality
  auto-grading (no partial credit for a partially-correct selection —
  documented limitation below).
- `short_answer` — free text. Auto-graded via case-insensitive exact match
  against `Question.acceptableAnswers` (`Json`, a string array) when
  configured; otherwise always requires manual `gradeAttempt()`.

## Topic/skill tagging for adaptive learning (foundational, per the session brief)

`QuestionTopic` reuses the exact `Topic`/`LessonTopic` shape Session 04
established (`Subject -> Topic -> Subtopic/Skill`, one self-referential
table) — `tagQuestion()`/`untagQuestion()` in `src/lib/questions.ts` mirror
`tagLesson()`/`untagLesson()` exactly. `Question` also carries `difficulty`
(`easy`/`medium`/`hard`) and a free-text `learningObjective` (curriculum
reference). None of this drives adaptive behavior yet — Session 08 owns
that — but every question is taggable/filterable by subject, topic,
difficulty, and objective today, which is what that session needs to build
on without a data-model migration first.

## Data model additions

`Question`, `QuestionOption`, `QuestionTopic`, `Assessment`,
`AssessmentQuestion`, `AssessmentVersion`, `AssessmentAssignment`, `Attempt`,
`Answer` — see `prisma/schema.prisma`'s "Assessment (Session 07)" section for
the full field list. Migration: `20260826202953_assessment_core`.
`AssessmentAssignment.courseId` is denormalized from `assessment.courseId`
(see the RLS-recursion note above). `Question`/`Assessment`/`Attempt`/
`Answer`/`AssessmentVersion` are never hard-deleted — `Question.archivedAt`
(soft archive; `archiveQuestion()`), `Assessment.status = "archived"`
(`archiveAssessment()`); `Attempt`/`Answer`/`AssessmentVersion` have **no**
DELETE policy at all, for any role.

## Routes

| Route | Portal | Purpose |
|---|---|---|
| `/assessments` | Teacher | Per-course assessment list + create-draft form |
| `/assessments/[id]` | Teacher | Builder: settings, question bank + create-question, publish/archive, assign to cohort/student, attempts roster |
| `/assessments/[id]/attempts/[attemptId]` | Teacher | Full-reveal attempt view + grading form for pending short-answer questions |
| `/assessments` | Student | Assigned assessments, status, start/resume/retake |
| `/assessments/[id]` | Student | Info/confirm page — instructions, attempts remaining, Start/Resume button (does **not** itself create an attempt — see below) |
| `/assessments/[id]/attempt` | Student | The live, redacted question form; submits via `submitAttempt()` |
| `/results` | Student | All of the student's own attempts |
| `/results/[attemptId]` | Student | Redacted (until graded) per-question result detail |

**Why the info page and the live-attempt page are split**: `startAttempt()`
is a write (creates an `Attempt` row) and is only idempotent for an
*existing* `in_progress` attempt — calling it when the latest attempt is
already `submitted`/`graded` and attempts remain creates a **new** one. If
the live-attempt page itself called `startAttempt()` on every `GET`, simply
reloading or revisiting the URL after finishing an attempt would silently
burn another one. The info page only ever *reads* (`getInProgressAttempt()`,
which never creates); only the explicit "Start/Resume" form submission calls
`startAttempt()`.

## Events

`AssessmentSubmitted` / `AssessmentGraded` — both pre-typed in
`src/lib/events.ts` since Session 01, emitted for the first time here.
`AssessmentSubmitted` fires on every `submitAttempt()` call.
`AssessmentGraded` fires once an attempt actually finalizes to `graded` —
either immediately in `submitAttempt()` (an all-objective assessment) or
later in `gradeAttempt()` (once every pending question has been manually
graded). Payload: `{ attemptId, studentId, assessmentId }`.

## Data Session 08 (Progress & Adaptive Learning) needs

- `Attempt.scorePercent`/`passed`/`gradedAt` — per-assessment outcome data,
  already computed and stored; Session 08 should read this rather than
  recompute it.
- `QuestionTopic` — the topic/skill tags on every question a student has
  answered, joined through `Answer.questionId` — the foundation for
  per-topic mastery aggregation this session was built to enable.
- `LessonCompleted`/`Enrollment.completedAt` are still unset by anything
  (Session 04's original flag, unchanged) — Assessment does not attempt to
  approximate course-completion from attempt data; that stays Session 08's
  call to make.

## Tests

- `src/lib/questions.test.ts` — bank CRUD, ownership boundary, `single_choice`/
  `multiple_choice` shape validation, archive/unarchive, topic tagging.
- `src/lib/assessments.test.ts` — create/update ownership boundary, publish
  requiring ≥1 question, **the versioning-immutability proof** (edit-after-
  publish leaves the earlier `AssessmentVersion` byte-for-byte unchanged,
  re-publish creates a new one), assignment ownership + enrollment
  validation, a student discovering (or not discovering) an assignment.
- `src/lib/attempts.test.ts` — authorized-assessment boundary (unassigned
  student rejected), `maxAttempts` enforcement, auto-grading (correct/
  incorrect/pending-short-answer), **tamper resistance** (cannot resubmit an
  already-submitted attempt; cannot submit answers for another student's
  attempt; cannot submit an invalid option id), manual grading (ownership
  boundary, cannot grade an `in_progress` attempt, grading the last pending
  question finalizes + reveals the answer key), results visibility
  (self-scoped for students, ownership-scoped for teachers).
- `src/lib/assessment-rls.integration.test.ts` — the same boundaries proved
  against the real non-superuser `portal_rls_test` role, independent of
  application code: a student can **never** SELECT `questions`/
  `question_options` directly; `assessments_select`/`assessment_versions_select`
  student branches; `attempts`/`answers` self-vs-teacher visibility; the
  `assessment_versions` append-only guarantee (no UPDATE/DELETE, any role).
  Skips (doesn't fail) if `RLS_TEST_DATABASE_URL` is unset, same convention
  as every other `*.integration.test.ts` in this repo.

## Known limitations

- **No server-side time-limit enforcement.** `Assessment.timeLimitMinutes`
  is stored and shown to the student, but nothing hard-cuts off a late
  submission — `submitAttempt()` accepts it regardless, timestamped
  accurately via `submittedAt`. Enforcing a hard cutoff needs a background
  job (auto-submit at expiry), which doesn't exist anywhere in this repo yet
  (Session 01's handoff flagged the same gap generally). Documented, not
  silently skipped.
- **No partial credit** on `multiple_choice` — the selected set must exactly
  equal the correct set, or the question scores zero. A deliberate MVP
  simplification; revisit if a future session needs partial-credit rubrics.
- **`short_answer` auto-grading is exact-match only** (case-insensitive) —
  no fuzzy matching/synonyms. Anything not an exact match against
  `acceptableAnswers` goes to manual grading, which is always reliable, just
  not automatic.
- **A teacher's `gradeAttempt()` can be called on any `submitted` attempt's
  answers, including ones already auto-graded** (no "already graded, can't
  override" guard) — this is deliberate override authority, not a bug, but
  worth knowing: a teacher can correct an auto-grade if they disagree with
  it, before or after the attempt fully finalizes.
- **No `Assessment` question-bank UI separate from an assessment's own
  builder page** — a teacher browses/creates bank questions from within
  whichever assessment they're editing (`listQuestionBank(courseId, ...)`
  is course-scoped and works from any entry point), not from a dedicated
  "/assessments/bank" screen. The API supports one; the UI wasn't built,
  out of scope for this pass.
- **`AssessmentAssignment` targets a cohort or one student**, not an
  individual-with-override-of-a-cohort-assignment or a "everyone except X"
  shape — matches the session's data-model contract (`AssessmentDataModel`
  ownership matrix), nothing more elaborate was requested.

## Blockers

None. Everything in this session's scope was buildable without any
external dependency or another module's missing capability — Session 05/06
had already built real, documented BLOCKED entry points
(`/teacher/assessments`, `/student/assessments`, `/student/results`)
anticipating exactly this contract, so this session filled them in rather
than inventing new routes.
