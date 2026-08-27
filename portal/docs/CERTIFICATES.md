# Certificates (Session 14)

Issues trustworthy completion certificates using canonical course/progress
data. Built entirely on top of Education Core (Session 04), Progress
(Session 08), and the Asset/File service (Session 13) — no parallel
completion calculation, no parallel file mechanism.

## Eligibility rule (the actual contract)

**A student becomes eligible the moment their `Enrollment.status` for a
course equals `'completed'`.** That column is owned and written entirely by
Progress's `recalculateCourseProgress()` (`src/lib/progress.ts`) — this
module never counts lessons, published modules, or anything else Progress
already computed. `src/lib/certificates.ts`'s `issueCertificateIfEligible()`
performs exactly one read against `Enrollment` and stops there.

This is the literal implementation of the session brief's "Must NOT
calculate course completion independently from Progress."

## Trigger: an action, not a button

There is no "Issue Certificate" button anywhere in the app. Issuance is a
side effect of a real completion action:

1. A student submits the real "Mark complete" form on a lesson page
   (`src/app/student/(protected)/courses/[courseId]/lessons/[lessonId]/actions.ts`'s
   `markLessonCompleteAction`).
2. That calls `markLessonComplete()` (Progress), which **awaits**
   `recalculateCourseProgress()` before returning — by the time it
   resolves, `Enrollment.status` is guaranteed fresh and committed.
3. Immediately after, the same action calls
   `issueCertificateIfEligible(courseId, actor)` (this session). It reads
   `Enrollment.status`, and if — and only if — it is `'completed'`, issues
   a certificate.

This is the ONE reliable path. `certificates.ts` also self-subscribes to
`LessonCompleted` (the same event Progress itself emits and self-subscribes
to) as a best-effort backstop for any future completion path that doesn't
go through the call site above — but that listener races against whichever
`recalculateCourseProgress()` invocation actually wins first, so it is
deliberately NOT treated as the reliable trigger, only a redundant, harmless
safety net (same "harmless redundant re-run" precedent Progress itself
established for its own `LessonCompleted` self-subscription).

## Forgery resistance

`issueCertificateIfEligible()` is the **only** function that ever writes a
`certificates` row, and it always writes under `systemCertificateCtx()` — a
narrow synthesized RLS context holding exactly one permission,
`certificates.manage`, never a real actor's own permission set (same shape
as Progress's `systemProgressCtx()`). No `STUDENT` or `TEACHER` role holds
`certificates.manage` (`src/lib/authz.ts`'s `DEFAULT_ROLE_PERMISSIONS`), so
the `certificates_write`/`certificates_update` RLS policies reject any real
actor's direct write attempt — proven live against the real non-superuser
`portal_rls_test` role in
`src/lib/certificates-rls.integration.test.ts` (a student cannot forge a
certificate for themselves even while holding an unrelated `courses.manage`
permission; only the `certificates.manage`-holding system context can
insert).

## Historical stability

`Certificate` snapshots `studentNameSnapshot`/`courseTitleSnapshot`/
`completedAt` at issuance time and never re-derives them — the same pattern
`AssessmentVersion` uses for `title`/`instructions`/`questions`. A later
course rename, re-authoring, or even the enrollment reverting back to
`active` (e.g. a teacher publishes a new lesson afterward, per Progress's
own documented reversibility) does **not** retroactively alter or revoke an
already-issued certificate — it is a permanent record of what was true at
issuance. `certificates` has **no DELETE RLS policy at all**, for any role
including super_admin; revocation (`revokeCertificate()`) is a `status`
flip (`active` -> `revoked`), never a row removal.

## Data model

One new table, `certificates` (migration `20260827180000_certificates_core`):

- `student_user_id`, `course_id`, `enrollment_id` — the specific completed
  enrollment that triggered issuance.
- `certificate_number` — the verification reference, `KA-<year>-<12 hex
  chars>`, generated server-side (`randomBytes(6)`), unique.
- `status` (`active`/`revoked`), `template_version` (reserved for a future
  certificate redesign without touching historical rows).
- `*_snapshot` fields — see "Historical stability" above.
- `revoked_at`/`revoked_by`/`revoked_reason`.
- `@@unique([studentUserId, courseId])` — one certificate per student per
  course, ever; this is also the idempotency backstop for the
  event-listener race described above.

Two follow-up migrations extend Session 13's Asset service exactly per its
own documented contract ("add an `AssetEntityType` value + a matching case
in `canAccessAssetAttachment()` + a matching RLS branch"):
`20260827190000_certificates_asset_entity_type` (the new `'certificate'`
enum value, its own migration since Postgres can't use a new enum value in
the same transaction that adds it — same `'message'`/`'sponsor_document'`
precedent from Sessions 09/11) and
`20260827200000_certificates_asset_attachments` (the RLS policy update).

## Downloadable certificate (optional, per the session's Owns list)

Generated eagerly at issuance (`attachDownloadableCertificate()`): a plain
`text/plain` file (no PDF library dependency added — see Known
limitations) rendered from the certificate's own snapshot fields, uploaded
through the real `uploadAsset()` (Session 13) as the student, then attached
via a normal `AssetAttachment` row (`entity_type='certificate'`). Downloads
go through the exact same generic `GET /assets/[id]/download` route every
other portal already has — no new download route was needed, only the new
`canAccessAssetAttachment()` case in `src/lib/assets.ts`.

## Views

- **Student** (`/student/certificates`, `/student/certificates/[id]`) —
  self-scoped list + a certificate-styled detail view with a download link.
  Gated behind the `certificates` feature flag (seeded off, same convention
  as `messaging`) — the underlying issuance/audit pipeline is NOT
  flag-gated (it's core plumbing, same treatment Notifications gave its
  in-app center), only the student-facing surface is, so certificates keep
  being issued and audited correctly even while the flag is off; an admin
  simply can't show them to students yet.
- **Admin** (`/admin/certificates`, `/admin/certificates/[id]`) — "verify by
  certificate number" search, a recently-issued table, and per-certificate
  revoke. Gated on the new `certificates.manage` permission (or
  super_admin) — **not** the feature flag, since staff verification is a
  distinct capability from the student rollout.

## Authorization

New permission key: `certificates.manage` (`src/lib/authz.ts`). No role
grants it by default except `ADMIN`/`SUPER_ADMIN` (via the existing
`ALL_PERMISSION_KEYS` convention). Read access
(`certificates_select`/`getCertificateById`) additionally allows the
certificate's own student and the course's teacher (via `cohort_teachers`,
the same ownership shape every other Education Core read uses) —
application-layer-checked in `getCertificateById()` too, not left to RLS
alone, per this codebase's own documented lesson (Session 06's cross-
student data-leak bug, and every session since that explicitly
double-checks ownership at the application layer rather than trusting RLS
silently hiding a row).

## Events

- **`CertificateIssued`** (`{ certificateId, studentId }`) — pre-typed
  since Session 01, first real emitter. Notifications (Session 10) already
  had a listener waiting for this exact shape (`src/lib/notifications.ts`)
  — confirmed live: the student's `/notifications` gets a
  `certificate_issued` row the moment issuance runs, no Notifications-side
  changes needed.
- No `CertificateRevoked` event was added — revocation is audited
  (`recordAuditEvent`) but does not notify; not required by the session
  brief, and adding an unrequested event/notification path was out of
  scope.

## Verification contract

`verifyCertificateByNumber(certificateNumber, actor)` — requires
`certificates.manage`/super_admin explicitly (not just relying on RLS to
return nothing to an unauthorized caller). Looks up by the unique
`certificate_number`, returns the full snapshot record (including
`status`) or `null`. This is the acceptance criterion "authorized staff can
verify it" — there is no unauthenticated/public verification page; only
admin-console staff can verify today.

## Known limitations

- **The downloadable file is plain text, not a designed PDF.** No PDF
  library exists in this repo's dependencies (`package.json`), and adding
  one is a real dependency decision beyond a single certificate feature —
  the file is a real, complete, correctly-served download through the real
  Asset service (satisfying the session's "optional downloadable
  certificate" requirement functionally), just not visually designed.
  Whoever wants a styled PDF should pick a library and swap
  `renderCertificateText()`/`attachDownloadableCertificate()`'s MIME type —
  the rest of the pipeline (upload, attach, download authorization) does
  not need to change.
- **No unauthenticated/public certificate-verification page** — only
  `certificates.manage`/super_admin can verify, per the session's "admin
  verification/management" scope (not "public verification"). Adding one
  is a straightforward follow-up (a public route calling
  `verifyCertificateByNumber` under a relaxed/no-permission variant) if a
  future session's brief asks for it.
- **No teacher-facing certificates UI** — a teacher CAN read a certificate
  for their own course's student (`certificates_select`'s cohort_teachers
  branch, proven in both test suites), but no page surfaces it yet. Not in
  this session's Owns list; a small addition for whoever needs it.
- Revocation is a status flip; RLS is row-level, not column-level — a
  `certificates.manage` holder is DB-permitted to update any column on a
  row it can already reach, not just the revocation fields (same
  documented limitation as `users_update`/`assets_update` in Sessions
  02/13). `revokeCertificate()` only ever writes the four revocation
  fields.
- A student can, in principle, hold multiple `Enrollment` rows for the same
  course across different cohorts over time (rare, e.g. withdraw + later
  re-enroll in a different cohort). `issueCertificateIfEligible()` doesn't
  care which one triggered issuance beyond recording it
  (`enrollmentId`) — the `@@unique([studentUserId, courseId])` constraint
  means only the first qualifying completion ever issues a certificate for
  that course, by design.

## Tests

- `src/lib/certificates.test.ts` (12) — eligibility gating (not-yet-
  eligible returns null and issues nothing), issuance + snapshot
  correctness + certificate-number format, idempotency, the "Must NOT
  expose" case, cross-actor visibility (self/teacher/admin allowed,
  outsider student rejected), `verifyCertificateByNumber`/
  `revokeCertificate`/`listRecentCertificates` all requiring
  `certificates.manage` (negative case: a plain student is rejected).
- `src/lib/certificates-rls.integration.test.ts` (7) — the real DB-level
  forgery-resistance proof against `portal_rls_test`: select scoping
  (self/teacher/outsider/certificates.manage), a student's INSERT attempt
  rejected even while holding `courses.manage`, `certificates.manage`
  succeeding, revocation requiring the permission, no DELETE policy at all
  (even for super_admin), and the new `asset_attachments` `'certificate'`
  branch's visibility cascade.
- Live-verified against a real running dev server (real
  `POST /auth/callback/credentials` logins, the real multipart
  `$ACTION_ID_*` Server Action encoding for "Mark complete"): completed
  both lessons of a real course as a real student — confirmed the
  certificate row appeared in Postgres **without ever calling an "issue"
  endpoint**, confirmed the student-facing page correctly stayed hidden
  behind the (default-off) `certificates` feature flag until enabled, then
  confirmed the certificate rendered correctly, the download route served
  the real generated text file, an unrelated second student got
  "Certificate not found" (the application-layer check, not just RLS), a
  crafted revoke POST using the wrong actor's session was rejected server-
  side with zero state change, and the real admin revoke flow worked end-
  to-end (status flipped, both `certificate.issued`/`certificate.revoked`
  audit rows present). All live-test fixture data (4 users, 1 course +
  full cascade, 1 certificate + its asset) was cleaned up afterward,
  verified zero rows remain; the `certificates` feature flag was reset to
  its default `off` state; the dev server process was stopped and
  confirmed unreachable.
