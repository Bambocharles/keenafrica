# Backup & restore

## Infrastructure this assumes

Postgres runs on its own VM (`postgres01`, Proxmox VMID 115), with `PGDATA`
on a mirrored ZFS pool (`tank`) — see `~/pve-create-postgres-vm.sh` on the
Proxmox host. That mirror protects against a single disk failure; it is
**not** a backup (it doesn't protect against a bad migration, a bad
`DELETE`, or an accidental `DROP TABLE`, and there was no logical-backup or
restore-tested procedure before this session).

**`postgres01` is not single-purpose** (discovered by Session 30, documented
here by Session 33): the instance hosts `keenafrica_portal_prod` alongside
three sibling databases, sharing the cluster-wide role catalog and
instance-level resources (`max_connections`, WAL, checkpoint I/O, buffer
pool):
- `keenafrica_portal` — the pre-cutover `dev.keenafrica.com` database.
  Deliberately preserved for its historical data; confirmed dormant (traced
  via git history, `68c0eea` "Decommission dev.keenafrica.com") — nothing in
  the live k8s cluster references it.
- `postgres` — the default administrative database every Postgres instance
  ships with.
- `testdb` — untraced. No reference anywhere in this repo's history; likely
  unrelated VM-setup scratch, not this application's.

None of these three are written to by the portal application. This is a
documentation gap fix, not a change in behavior — `pg-backup.sh`/
`pg-restore.sh` above operate on `DATABASE_URL`'s target database only
(`keenafrica_portal_prod` in production), so the sibling databases were
never included or excluded by any backup decision; they simply were never
mentioned. Whether to delete the dormant `keenafrica_portal` database
remains an open, low-priority decision for whoever owns `postgres01` — not
made by this session (see `docs/GO_LIVE_READINESS.md`'s data-integrity
section for the investigation this was originally found during).

The self-hosted GitHub Actions runner (`keenafrica-vm`) already has network
access to the DB (used today by `deploy-portal.yml` to run
`prisma migrate deploy`) and has Docker installed. Backups run there rather
than on `postgres01` itself, so a problem on the DB host doesn't also take
out its own backups.

## Mechanism

- `scripts/backup/pg-backup.sh` — `pg_dump --format=custom` via a
  disposable `postgres:16-alpine` container (no client install needed on
  the host), writes a timestamped `.dump` to `$BACKUP_DIR`, sanity-checks
  the archive with `pg_restore --list`, and prunes old dumps (14 daily + 8
  weekly + 6 monthly, configurable).
- `scripts/backup/pg-restore.sh` — `pg_restore --clean --if-exists` into a
  target `DATABASE_URL`, gated behind `RESTORE_CONFIRM=yes` so it can't be
  run by accident.
- `scripts/backup/test-restore-drill.sh` — the same two scripts run
  end-to-end against **disposable, local-only** Postgres containers: spins
  up a source DB, applies real migrations, inserts a marker row, backs it
  up, spins up a second empty "disaster" DB, restores into it, and asserts
  the marker row and RLS policies survived. Never touches a shared
  database. This is what was actually run to validate this mechanism
  before it shipped — see the Session 01 handoff for the transcript.
- `.github/workflows/backup-portal-db.yml` — runs `pg-backup.sh` against
  prod daily (02:17 UTC) using the `PORTAL_DATABASE_URL_PROD` secret
  (`environment: production`, same manual-approval gate as deploys), then
  immediately restores the fresh dump into a throwaway container and checks
  it has rows and RLS policies. **A backup that fails to restore fails the
  workflow** — that failure is the alert.

## Why the migrator role

`DATABASE_URL` for backup/restore must be a role that **bypasses RLS** —
in production, `kf_portal_prod_migrator` (the same role
`deploy-portal.yml` already uses for `prisma migrate deploy`, which owns
the tables and bypasses RLS as owner per `README.md`). The runtime app role
(`kf_portal_prod_app`) is RLS-scoped and has no session context outside a
request — a dump taken through it would return almost nothing (an
anonymous `SELECT` sees no rows in `users`, no non-active `projects`,
etc.). This is not a hypothetical: it was confirmed against this schema's
actual policies during setup, not just inferred from reading them.

## Retention

Default schedule (overridable via `RETENTION_*` env vars on
`pg-backup.sh`): 14 daily, 8 weekly (latest per ISO week), 6 monthly
(latest per calendar month). Dumps live under `/home/keen/backups/portal-db`
on the runner host — a different physical host than `postgres01`, giving
real (if informal) 2-location redundancy. This is not yet offsite/3-2-1;
see Known limitations below.

## Restore runbook (real incident)

1. Identify the dump to restore: `ls -t /home/keen/backups/portal-db/*.dump | head -1` for
   latest, or pick an earlier one by its `portal-<UTC-timestamp>.dump` name.
2. Confirm the target database exists (restore does not create a
   database — `pg_restore --dbname` connects to an existing one) and that
   its extensions are present: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS citext;`.
3. Stop application traffic to that database if possible (scale the portal
   deployment to 0, or at minimum accept that in-flight writes during the
   restore window are lost).
4. Run:
   ```bash
   RESTORE_CONFIRM=yes ./scripts/backup/pg-restore.sh \
     /home/keen/backups/portal-db/portal-<timestamp>.dump \
     "$PORTAL_DATABASE_URL_PROD"
   ```
5. Spot-check: row counts on `users`/`sponsors`/`projects`, and
   `SELECT count(*) FROM pg_policies;` — compare against the same query run
   on a known-good environment (e.g. local dev on the same migration set)
   rather than a hardcoded number here, since it grows with every session
   that adds an RLS policy (145 as of Session 16's
   `production_hardening_rate_limit` migration — already stale by the time
   you read this if a later session added more).
6. Resume application traffic.

## Verifying this still works

Run `./scripts/backup/test-restore-drill.sh` any time the schema, the
backup/restore scripts, or the RLS policies change — it's self-contained
(Docker only, no prod access) and takes well under a minute. The scheduled
workflow above also re-proves it against a real prod dump every day as a
side effect of taking the backup.

## Known limitations / follow-ups

- **No true offsite copy.** Dumps live on the CI runner host only. A
  second physical/geographic copy (e.g. synced to object storage) is
  recommended before this is treated as production-grade DR — flagged as a
  limitation in the Session 01 handoff, not built here since no object
  storage is currently provisioned for the platform (see
  `status/project-status.md`).
- **Encryption at rest** for the ZFS pool and for backup files at their
  storage location is not currently configured — flagged, not decided
  here (infra/cost tradeoff).
- **No PITR/WAL archiving** — this is logical (`pg_dump`) backup only, so
  recovery granularity is "as of the last daily dump," not point-in-time.
  Acceptable for current data volume/criticality; revisit if that changes.
