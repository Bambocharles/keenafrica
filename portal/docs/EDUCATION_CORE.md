# Education Core (Session 04)

The canonical learning domain underneath the Teacher (Session 05) and
Student (Session 06) applications. Built from zero on top of Session 02's
Role/Permission model — no separate course/enrollment system.

## Core relationship

```
Course -> Cohort -> Teacher(s) + Students
Course -> Modules -> Lessons -> Resources
```

There is no direct Course→Teacher link. A teacher's authority over a
course's content is always mediated through a `cohort_teachers` row on one
of that course's cohorts — this is the ownership boundary every content
check walks (`isCourseTeacher()`/`requireCourseContentAccess()` in
`src/lib/courses.ts`), and the RLS policies in the
`20260826150000_education_core` migration enforce the identical shape
independently at the database level.

## Entities added

`Course`, `Cohort`, `CohortTeacher`, `Enrollment`, `Module`, `Lesson`,
`LessonVersion`, `Resource`, `Topic`, `LessonTopic` — see
`prisma/schema.prisma`'s "Education Core" section for the full field list.

- `Lesson.courseId` is denormalized from `module.courseId` (immutable —
  lessons are never moved across courses in this foundation) so every RLS
  ownership/visibility check is a single join instead of a three-table walk
  through `modules` on every lesson read/write.
- `LessonVersion` is the content-versioning foundation: every `publishLesson()`
  call snapshots the lesson's current title/content into an immutable row
  first, then bumps `Lesson.version`. Nothing reads these yet — no
  Progress/Attempt model exists to pin a student's completion to a specific
  version — but the history is captured and can never be silently
  overwritten by a later draft edit. Append-only at the RLS layer, same
  shape as `audit_events`: no `UPDATE`/`DELETE` policy exists at all.
- `Topic` is one self-referential table (`parentId`) modeling
  Subject → Topic → Subtopic/Skill, rather than three separate tables.
  Tags `Lesson` content today via `LessonTopic`. Session 07 (Assessment) is
  expected to reuse this same table for `Question` tagging — do not build a
  parallel taxonomy.

## Content lifecycle

`Course.status`: `draft` → `published` → `archived` (course-level — governs
whether the course is "live"; admin-only transition via `courses.publish`).

`Module.status` / `Lesson.status`: `draft` → `published` → `draft` (can
toggle back and forth any number of times — every publish creates a new
`LessonVersion` snapshot). This is a shorter lifecycle than the platform's
full `DRAFT → REVIEW/READY → APPROVED → PUBLISHED → ARCHIVED` per
`PLATFORM_ARCHITECTURE.md` §7's explicit allowance ("if a review step is
unnecessary for a given content type, the platform can allow a shorter
transition, but visibility must remain explicit") — there is no
teacher-facing review/approval step in this session; a teacher's publish
action is authoritative once they hold `courses.content.publish` and are
assigned to the course.

**Draft content is invisible to students, enforced at two independent
layers:**
1. Application layer — `getCourseContentForStudent()` (`src/lib/content.ts`)
   explicitly filters `status: "published"` and requires an active/completed
   enrollment (`assertActiveEnrollment()`).
2. Database layer — `modules_select`/`lessons_select` RLS policies require
   `status = 'published'` AND an active/completed enrollment row, checked
   independently by Postgres regardless of what the application code does.
   Proven against a real non-superuser role in
   `src/lib/education-rls.integration.test.ts`.

## Permissions added

| Key | Held by default | Scope |
|---|---|---|
| `courses.create` | ADMIN, SUPER_ADMIN | Create a course |
| `courses.manage` | ADMIN, SUPER_ADMIN | Course metadata, cohorts, teacher assignment, enrollment |
| `courses.publish` | ADMIN, SUPER_ADMIN | Course-level draft→published→archived transitions |
| `courses.content.write` | TEACHER, ADMIN, SUPER_ADMIN | Create/edit Module/Lesson/Resource/topic-tags — **ownership-scoped** |
| `courses.content.publish` | TEACHER, ADMIN, SUPER_ADMIN | Publish/unpublish Module/Lesson — **ownership-scoped** |
| `topics.manage` | ADMIN, SUPER_ADMIN | Subject/Topic/Skill taxonomy |

"Ownership-scoped" means: `courses.manage` or `isSuperAdmin` bypasses
ownership entirely; otherwise the holder must additionally be a
`cohort_teachers` row for a cohort of the specific course being acted on
(`requireCourseContentAccess()`). Holding the permission alone, with no
matching cohort assignment, grants nothing — verified in
`src/lib/content.test.ts`'s "outsider teacher" cases and independently at
the RLS layer in `education-rls.integration.test.ts`.

`courses.publish` (course-level) is deliberately a separate key from
`courses.manage`, matching `PLATFORM_ARCHITECTURE.md` §6's explicit
`courses.publish` example — a course's overall lifecycle state is kept
distinct from day-to-day cohort/enrollment administration, even though both
default to the same roles today.

## APIs/contracts

`src/lib/courses.ts` — `createCourse`, `updateCourseDetails`,
`publishCourse`, `archiveCourse`, `listCourses` (admin directory),
`listMyCourses` (teacher, cohort-scoped), `getCourseById`, `createCohort`,
`archiveCohort`, `listCohortsForCourse`, `assignTeacherToCohort` (validates
target holds `TEACHER` role), `removeTeacherFromCohort`, `enrollStudent`
(validates target holds `STUDENT` role, idempotent, reactivates a withdrawn
enrollment), `withdrawEnrollment`, `listEnrollmentsForCohort`,
`listMyEnrollments` (student, self-scoped), `assertActiveEnrollment`,
`isCourseTeacher`, `requireCourseContentAccess` (the shared ownership gate
`content.ts`/`topics.ts` both import).

`src/lib/content.ts` — `createModule`, `updateModule`, `reorderModules`,
`publishModule`, `unpublishModule`, `createLesson`, `updateLesson`,
`reorderLessons`, `publishLesson` (snapshots a `LessonVersion`),
`unpublishLesson`, `getCourseContentForTeacher` (all statuses),
`getCourseContentForStudent` (published-only, enrollment-gated),
`addResource`, `removeResource`.

`src/lib/topics.ts` — `createTopic`, `listTopics` (public), `tagLesson`,
`untagLesson`.

## Domain events

- `CoursePublished` — emitted by `publishCourse()`. Already typed in
  `DomainEventMap` since Session 01; this is the first real emitter.
- `StudentEnrolled` — emitted by `enrollStudent()`. Same.

No other events are emitted this session — `LessonCompleted` (Progress,
Session 08), `AssessmentPublished`-style events (Assessment, Session 07)
etc. belong to the sessions that own those entities, per
`docs/EVENTS.md`'s ownership rule.

## Admin UI

`src/app/admin/(protected)/education/**` — minimal, deliberately scoped to
what the acceptance criteria require of Admin: course directory + create,
course detail (publish/archive, edit metadata, cohort list, per-cohort
teacher assignment by email, per-cohort enrollment by email). Dashboard's
former "Education management" placeholder card (Session 03) now shows real
course/cohort/enrollment counts and links to `/education`.

**Deliberately not built here**: any Module/Lesson/Resource/Topic authoring
UI, or a student-facing content view — those are Session 05 (Teacher) and
Session 06 (Student)'s screens, exercised in this session only through
`src/lib/content.ts`/`src/lib/topics.ts` directly (see the vertical-slice
test and the live verification below). The course detail page carries an
explicit banner saying so, so nobody mistakes the gap for an oversight.

## Verification

- `npm test` — 133/133 passing, including:
  - `src/lib/courses.test.ts`, `src/lib/content.test.ts`,
    `src/lib/topics.test.ts` — positive + negative authorization for every
    mutating function, ownership-boundary cases (outsider teacher rejected),
    idempotency (re-enrolling, re-tagging), versioning (publish snapshots,
    edit-then-republish preserves history).
  - `src/lib/education-vertical-slice.test.ts` — the explicit
    Admin→Teacher→Publish→Student-visibility acceptance-criteria slice,
    driven entirely through the public `courses.ts`/`content.ts` API.
  - `src/lib/education-rls.integration.test.ts` — the same visibility/
    ownership boundaries proven against the real non-superuser
    `portal_rls_test` role, independent of application code (skips if
    `RLS_TEST_DATABASE_URL` is unset — see
    `scripts/dev/create-rls-test-role.sql`).
- Live E2E verification against a running dev server: logged in as a real
  super-admin (replicating the exact multipart `$ACTION_ID_*` Server Action
  encoding, per Session 03's precedent — no browser-automation tool was
  available in this session either), created a course through
  `/education`'s real form, published it, created a cohort, created a
  TEACHER and a STUDENT account through the existing `/users` UI, assigned
  the teacher and enrolled the student through `/education/[id]`'s real
  forms — all verified against actual DB rows afterward. Then, as no
  Teacher UI exists yet, drove `createModule`/`createLesson`/`publishModule`/
  `publishLesson`/`getCourseContentForStudent` directly to prove: the
  enrolled student saw zero modules before anything was published, and
  after publishing exactly one of two lessons, saw only that lesson — the
  still-draft sibling stayed invisible. All smoke-test data cleaned up
  afterward (`cleanupTestCourses`/`cleanupTestUsers`).
- `npm run build` and `npx tsc --noEmit` both pass.

## Known limitations

- No Teacher or Student UI (out of this session's boundary — see Session
  05/06).
- `Enrollment.completedAt` exists in the schema but nothing sets it yet —
  completion is driven by lesson-completion aggregation, which needs a
  Progress model (Session 08) that doesn't exist yet.
- `Resource` is an external URL only (`link`/`document`/`video` as a type
  label, not a real upload) — no file-upload/storage abstraction exists
  anywhere in the app yet (flagged by Session 01's handoff too). Belongs to
  Session 13 (Files & Content).
- No content review/approval step — a `courses.content.publish` holder's
  publish action is immediately live to enrolled students. Acceptable per
  `PLATFORM_ARCHITECTURE.md` §7's "shorter transition" allowance; revisit if
  a review workflow becomes a real requirement.
- `reorderModules`/`reorderLessons` write one `UPDATE` per item in a loop
  inside a single transaction — fine at foundation scale (a course rarely
  has more than a few dozen modules/lessons), revisit if that changes.
- Admin's teacher/student assignment UI resolves a typed email to a user id
  via a plain lookup (`resolveUserIdByEmail` in
  `src/app/admin/(protected)/education/[id]/actions.ts`) — there's no
  autocomplete/search UI; fine for a minimal admin surface, worth revisiting
  if the user base grows large enough that typos become a real problem.

## Required next-session actions

- **Session 05 (Teacher)**: build the authoring UI over
  `src/lib/content.ts`/`src/lib/topics.ts` — module/lesson CRUD, reordering,
  publish/unpublish, resource attachment, topic tagging. The permission
  model (`courses.content.write`/`courses.content.publish`, ownership-scoped
  via `cohort_teachers`) is already in place and tested; no new tables
  needed.
- **Session 06 (Student)**: build the student-facing course view over
  `getCourseContentForStudent()`/`listMyEnrollments()`
  (`src/lib/content.ts`/`src/lib/courses.ts`) — both already enforce
  published-only visibility and active-enrollment gating server-side.
- **Session 07 (Assessment)**: reuse the `Topic`/`LessonTopic` pattern for
  `Question` tagging rather than building a parallel taxonomy — see
  `Topic`'s schema comment.
- **Session 08 (Progress & Adaptive Learning)**: owns `Enrollment.completedAt`
  and any `LessonCompleted` event emission (typed in `DomainEventMap` since
  Session 01, still unemitted) — Education Core deliberately did not guess
  at a completion-aggregation rule.
- **Session 11 (Sponsor)** / whoever eventually reports on education
  outcomes: `LessonVersion` is now the audit trail for "what did a student
  actually see" — consume it rather than assuming `Lesson`'s current
  (possibly-since-edited) row reflects historical content.
