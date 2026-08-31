# Files & Content Assets (Session 13)

The canonical Asset/File service for the whole platform
(PLATFORM_ARCHITECTURE.md §11). One `Asset` table + one generic
`AssetAttachment` join, consumed by course resources today and intended for
message/sponsor-document/certificate attachments once Sessions 09/11/14
land — never a second per-module file table.

## What this session owns

- `Asset`/`AssetAttachment` data model.
- Storage abstraction (`src/lib/storage.ts`) — local disk today, swappable
  without touching any domain model.
- Upload validation (size + declared MIME type + magic-byte content check).
- Upload/download authorization (`src/lib/assets.ts`).
- Wiring into the one real, existing consumer: `Resource`
  (`src/lib/content.ts`'s `addResourceFromUpload`/`removeResource`).
- Download routes: `GET /assets/[id]/download` under each portal's own
  subdomain (`admin.`/`teacher.`/`student.`).

## What this session does NOT own

- Messaging attachments (Session 09), sponsor documents (Session 11),
  certificate assets (Session 14) — those sessions attach to this same
  `Asset` table by adding their own `AssetEntityType` value + a case in
  `canAccessAssetAttachment()`, not a parallel file system. See "Extending
  this for a new consumer" below.
- Virus/malware scanning infrastructure (e.g. ClamAV) — doesn't exist
  anywhere in this infra. See Known limitations.
- A production object-storage backend (S3 or equivalent) — doesn't exist
  yet. See Known limitations.

## Data model

```
Asset
  id, uploaderId, originalFilename, mimeType, sizeBytes,
  storageDriver, storageKey (opaque, unique), checksumSha256,
  status (active|deleted), createdAt, deletedAt

AssetAttachment
  id, assetId, entityType (AssetEntityType — only "lesson_resource" today),
  entityId (polymorphic — no FK, same shape as StudentNote/Bookmark's
  targetType/targetId), attachedBy, attachedAt
  unique(entityType, entityId)  -- today's shape is 1 asset : 1 entity

Resource (Education Core, Session 04 — extended here)
  url        now nullable (external-link resources, unchanged behavior)
  assetId    nullable, unique FK -> Asset (upload-backed resources)
  CHECK (url IS NOT NULL OR asset_id IS NOT NULL)
```

Postgres never stores binary content — `Asset` is metadata only; bytes live
behind `StorageDriver`.

## Storage abstraction

`src/lib/storage.ts` — `StorageDriver { put, get, delete }`, keyed by an
opaque server-generated UUID (`storageKey`), never a caller-supplied path.
This is what makes path traversal structurally impossible rather than
something a sanitizer has to catch.

Two drivers exist:

- `LocalDiskStorageDriver` (`STORAGE_DRIVER=local`, the default) —
  `ASSET_STORAGE_LOCAL_ROOT`, default `<repo>/var/asset-storage`, outside
  `public/`. Fine for local dev; **not safe in production** with more than
  one replica and no shared volume — see "Session 32" below for why this
  broke production.
- `S3StorageDriver` (`STORAGE_DRIVER=s3`, **production's driver as of
  Session 32**) — a generic S3-API driver (works against any S3-compatible
  vendor: AWS S3, R2, MinIO, Backblaze B2, ...), not vendor-specific, even
  though production is currently configured against Cloudflare R2. Signs
  requests with `aws4fetch` (a ~2KB, zero-dependency SigV4 signer over the
  platform `fetch()`) rather than `@aws-sdk/client-s3` — this driver only
  needs three verbs (PUT/GET/DELETE object), and the full AWS SDK is a much
  heavier dependency for that; matches this codebase's existing bias
  (Session 19's mailer chose plain `fetch()` over an SDK for the same
  reason). Configured via `S3_BUCKET`/`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`/`S3_REGION` — see `docs/ENVIRONMENT.md`.

Swapping the vendor again later means implementing `StorageDriver` and
changing `STORAGE_DRIVER` (or the `S3_*` env vars, if it's still
S3-compatible) — `src/lib/assets.ts` and everything above it is
unaffected, satisfying the acceptance criterion "storage vendor can change
without rewriting domain models." This held exactly as designed when
Session 32 added the second driver: zero changes to `assets.ts`,
`content.ts`, the Asset/AssetAttachment schema, or any authorization logic.

## Session 32 — production object storage decision

Session 30 (go-live readiness) confirmed live what Sessions 09/13/28 had
already flagged: `k8s/portal-prod.yaml` runs 2 replicas with no persistent
volume, so `STORAGE_DRIVER=local` writes an upload to whichever pod
handled it, and downloading from the other pod 500s. This blocked
Resources, Sponsor documents, Certificates, and Messaging attachments for
any real user.

**Chose Cloudflare R2 (S3-compatible object storage) over a shared
ReadWriteMany PVC**, decided against this specific infra rather than in
the abstract:

- This platform's infra is self-managed Docker/VM hosts running a
  single-node-control-plane k3s cluster (`keenafrica-infra` +
  `keenafrica-worker-1`/`-2`, per `docs/QA_LIVE_TEST_ACCOUNTS.md`) — no
  managed-cloud CSI driver providing a tested RWX volume story. Standing up
  NFS (or similar) ourselves would be genuinely new infrastructure with its
  own single-point-of-failure risk, not a shortcut, and nothing in this
  infra today provides or tests that guarantee.
- Cloudflare is already this domain's DNS/edge/tunnel provider
  (`terraform/providers.tf`, `main.tf`) — one fewer vendor relationship,
  and R2 has zero egress fees (relevant once uploads/downloads are real
  production traffic across four consumers).
- R2's S3-compatible API means the new driver is a generic
  `S3StorageDriver`, not an R2-specific one — the same vendor-neutrality
  `PLATFORM_ARCHITECTURE.md` §11 already required of the abstraction,
  satisfied one level further down (see "Storage abstraction" above).

**Infrastructure provisioned**: `terraform/portal-storage.tf` —
`cloudflare_r2_bucket.portal_assets`, named `keenafrica-portal-assets-prod`
(per-environment naming; only `prod` is provisioned today, since staging
doesn't exist per `docs/ENVIRONMENT.md`). Applied live via
`terraform apply -var-file=envs/prod.tfvars -target=cloudflare_r2_bucket.portal_assets`.
The R2 API token (S3 Access Key ID/Secret Access Key) was created via the
R2 dashboard's own "Manage R2 API Tokens" flow, scoped to Object Read &
Write on just this bucket — not via Terraform (the `cloudflare` provider
has no resource for R2 token/credential creation; see
`terraform/portal-storage.tf`'s comment for why the generic
`cloudflare_api_token` path was rejected) — and written directly to the
`portal-secrets` k8s Secret, never committed anywhere.

**Pre-existing `local`-driver files in production**: 2 rows found via
`SELECT id, original_filename, size_bytes, created_at, uploader_id FROM
assets WHERE storage_driver='local' AND status='active';` (run by the
site owner against `keenafrica_portal_prod` — this sandbox's own DB
access is blocked the same way every session since 22 has been):

| id | filename | size | created_at |
|---|---|---|---|
| `6d5688a1-31d4-4d7a-acb1-f190ddd64c50` | `certificate-KA-2026-2FB5355B6CA3.txt` | 600 B | 2026-08-29 06:38:57 UTC |
| `a9253692-ddc0-410d-98fc-1285cc457e9c` | `qa_doc.txt` | 60 B | 2026-08-29 07:58:27 UTC |

The second is Session 28's own already-documented sponsor-document QA
fixture (`docs/QA_SPONSOR_LIVE_PASS.md`: "left in place... its own broken
state is itself useful evidence"). Both predate this session by two days
and multiple full production redeploys (Session 29's merge, Session 31's
two PRs, this session's own) — each `deploy-portal.yml` run replaces every
pod, and `local` storage lives on the pod's own ephemeral writable layer,
not a volume, so it does not survive a pod being replaced. **Not
migrated, because the underlying bytes are already gone** — there is
nothing left on any pod's disk to copy into R2, for either row. Explicitly
acknowledged here rather than silently left as dangling `active` rows: a
download attempt against either would already have failed before this
session (via the old `local` driver, same as any other post-redeploy
`local` row) and continues to fail now (via `S3StorageDriver`, since the
key was never written to R2 either) — behavior is unchanged for these two
specific rows, not newly broken by this session. Whoever next touches
`Asset` lifecycle/cleanup could reasonably soft-delete these two rows
(`status='deleted'`) as unrecoverable orphans; left as-is here since
that's a data cleanup decision outside this session's scope (no schema/
authorization changes, per this session's own rules).

**Verified live, post-fix**: repeated Session 28's exact repro — real QA
TEACHER upload (through pod `rg964`) confirmed landing in the R2 bucket
via the Cloudflare API (not local disk), then 26/26 downloads over the
public URL succeeded byte-for-byte identical to the original, against a
Service with exactly 2 pod endpoints — see `status/project-status.md`'s
Session 32 entry for the full transcript.

## Upload validation

`src/lib/assets.ts`'s `uploadAsset()`:
- Rejects anything over `ASSET_MAX_SIZE_BYTES` (default 25 MiB).
- Rejects any MIME type not on the allowlist (PDF, PNG/JPEG/GIF/WEBP,
  docx/pptx/xlsx, MP4/WEBM, plain text/CSV).
- Rejects content whose magic bytes don't match its declared MIME type
  (never trusts the client-declared `File.type` alone) —
  `UnsupportedFileTypeError`.
- Never derives the storage path from the caller-supplied filename —
  `originalFilename` is metadata only, displayed and echoed back in the
  `Content-Disposition` header (CR/LF stripped there specifically).

## Ownership / visibility rules

- The uploader (`Asset.uploaderId`) can always read/download their own
  asset, including an unattached ("orphan") one.
- `super_admin` can always.
- Otherwise, visibility is derived ENTIRELY from what the asset is attached
  to (`AssetAttachment`) — an unattached asset nobody else uploaded is
  invisible to everyone but its uploader.
- For `entityType = "lesson_resource"`: a course teacher (`cohort_teachers`
  row, same ownership check as `src/lib/courses.ts`) or `courses.manage`/
  `super_admin` sees it regardless of publish status; a student sees it
  only once the owning lesson AND module are both `published` AND they
  hold an active/completed enrollment — the EXACT same rule
  `getCourseContentForStudent()` already enforces, not a second visibility
  rule for the same data.

No new permission keys — upload/attach reuses Session 04's
`courses.content.write` (ownership-scoped via `cohort_teachers`); download
reuses the same read rules `content.ts` already enforces.

## RLS (defense in depth)

Both tables are RLS-enabled, mirroring the rest of this repo's convention
of enforcing the same rule independently at the database layer:

- `assets_select`/`asset_attachments_select` cascade through
  `resources_select` (which itself cascades through `lessons_select`) for
  `lesson_resource` — a subquery against an RLS-protected table is itself
  subject to that table's SELECT policy, so this stays in sync with
  `lessons_select` automatically instead of duplicating its branches (same
  convention as `resources_select`/`lesson_versions_select` in the
  education_core migration).
- `assets_write`: any authenticated user may create an Asset row FOR
  THEMSELVES; spoofing another user's `uploader_id` is rejected. What that
  upload may actually attach to is gated by `asset_attachments_write`
  instead, mirroring how `resources_write` (not `assets_write`) is where
  `courses.content.write` + cohort ownership is actually enforced.
- `assets_update`: soft-delete only (`status='deleted'`), uploader or
  super_admin. No DELETE policy on `assets` at all, for any role — the
  metadata row is permanent history; see "Deletion" below.
- `asset_attachments_delete`: same ownership shape as `resources_delete` —
  a genuinely live join (cohort_teachers-scoped), unlike `assets` itself.

**A real bug found and fixed while authoring this migration**: an earlier
draft had `asset_attachments_select` re-check `assets.uploader_id` via a
subquery against `assets`, while `assets_select` ALSO subqueries
`asset_attachments` (to cascade visibility to non-uploader viewers) —
evaluating either policy re-triggered the other, and Postgres raised
"infinite recursion detected in policy" (42P17). Same class of bug as
Session 08's `assessments_select` ↔ `assessment_assignments_select` cycle.
Reproduced live by this session's own
`assets-rls.integration.test.ts` against the real non-superuser
`portal_rls_test` role. Fixed by removing the redundant uploader branch
from `asset_attachments_select` — nothing in `canAccessAsset()` actually
needs it (the uploader check happens via `assets_select`'s own independent
`uploader_id` branch, before `asset_attachments` is ever queried). Full
reasoning is in the migration SQL's own comment; read it before adding a
second cross-table branch to either policy.

## Deletion

"Deleting" an asset is always an application-layer soft-delete
(`deleteAssetIfOrphaned`/`deleteAssetIfOrphanedAsContentOwner` in
`src/lib/assets.ts`) — `status='deleted'`, storage bytes purged, metadata
row kept as permanent history (no DELETE RLS policy exists for `assets` at
all, for any role). It only runs once every `AssetAttachment` referencing
the asset is gone — `content.ts`'s `removeResource()` detaches (deletes the
attachment row) BEFORE deleting the `Resource` row, because
`asset_attachments_delete`'s RLS policy re-derives ownership through the
still-existing resource; deleting the resource first would make that
ownership check unresolvable. Get this ordering wrong and the RLS DELETE
silently matches zero rows.

## API contract (`src/lib/assets.ts`)

- `uploadAsset(input, actor)` — validates + stores bytes + creates the
  `Asset` row. Does NOT attach it to anything; callers create the
  `AssetAttachment` row themselves in the same transaction as whatever
  they're wiring it to (see `content.ts`'s `addResourceFromUpload`).
- `canAccessAsset(assetId, actor): Promise<boolean>`
- `getAssetForDownload(assetId, actor)` — throws `AuthorizationError`/
  `AssetNotFoundError`; returns `{ buffer, mimeType, filename }`.
- `assetDownloadResponse(assetId, actor): Promise<Response>` — the one
  shared download-response builder every portal's
  `assets/[id]/download/route.ts` calls after its own `auth()` +
  portal-shell-gate check (route handlers are NOT wrapped by their
  segment's `layout.tsx` guard in the Next.js App Router).
- `deleteAssetIfOrphaned(assetId, actor)` — actor-facing (uploader or
  super_admin only).
- `deleteAssetIfOrphanedAsContentOwner(assetId, actor)` — for callers that
  already authorized the actor against the specific business entity (e.g.
  `content.ts`'s `requireCourseContentAccess`) — skips the
  uploader-identity re-check, mirroring `src/lib/sessions.ts`'s
  `revokeAllUserSessionsAsSystem` "internal, for already-authorized
  callers only" convention.
- `maxAssetSizeBytes()`, `UnsupportedFileTypeError`, `FileTooLargeError`,
  `AssetNotFoundError`.

`src/lib/content.ts` additions: `addResourceFromUpload(lessonId, input,
actor)`, `removeResource()` extended to detach + purge the underlying asset.

## Extending this for a new consumer (Sessions 09/11/14)

1. Add your `AssetEntityType` value via a migration (additive —
   `ALTER TYPE ... ADD VALUE`).
2. Add a case to `canAccessAssetAttachment()` in `src/lib/assets.ts`
   implementing YOUR entity's existing read rule (do not invent a new one —
   reuse whatever ownership check your module's own library already
   enforces, the same way `lesson_resource` reuses `courses.ts`'s
   `isCourseTeacher`/`assertActiveEnrollment`).
3. Add the matching branch to `asset_attachments_select`/`_write`/`_delete`
   in a new migration, mirroring your entity's own RLS-protected table's
   policy (never a parallel access-control mechanism).
4. Call `uploadAsset()` + create your `AssetAttachment` row in your own
   module's function, the same shape as `addResourceFromUpload`.
5. Add a thin `assets/[id]/download/route.ts` under your portal's subdomain
   tree if one doesn't already reach the entity types you need (admin/
   teacher/student routes already exist and call the same shared
   `assetDownloadResponse()` — a sponsor portal will need its own).

## Known limitations

- **No production object-storage backend.** Only a local-disk
  `StorageDriver` exists; the k8s deployment (`k8s/portal-prod.yaml`) has
  no persistent volume, so uploaded files would NOT survive a pod restart
  or scale beyond one replica in production today. Provisioning a bucket/
  credential and implementing an `S3StorageDriver` (or equivalent) is an
  infra decision outside this session's authority — same shape as Session
  02's missing transactional-email-provider blocker. **Do not deploy file
  uploads to production before this is resolved.**
- **No malware/virus scanning.** Content-based MIME validation (magic
  bytes) catches "wrong file type" but not a well-formed-but-malicious file
  of an allowed type. Real scanning needs dedicated infrastructure (e.g.
  ClamAV) that doesn't exist yet.
- **`AssetAttachment` is 1:1 today** (`@@unique([entityType, entityId])`).
  A future entity type that legitimately needs multiple assets per entity
  (e.g. a message with several attachments) needs this loosened — not
  required by anything in this session's scope.
- Every download streams the full file into memory (`Buffer`) rather than
  a true streaming response — fine at the current expected file sizes (≤25
  MiB default cap); revisit if much larger files become a requirement.
