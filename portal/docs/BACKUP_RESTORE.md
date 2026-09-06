# Backup & restore

## Infrastructure this assumes

Postgres runs on its own VM (`postgres01`, Proxmox VMID 115), with `PGDATA`
on a mirrored ZFS pool (`tank`) — see `~/pve-create-postgres-vm.sh` on the
Proxmox host. That mirror protects against a single disk failure; it is
**not** a backup (it doesn't protect against a bad migration, a bad
`DELETE`, or an accidental `DROP TABLE`, and there was no logical-backup or
restore-tested procedure before this session).

**`postgres01` is not single-purpose** (discovered by Session 30, documented
here by Session 45 — Session 33 wrote this up but was never merged): the
instance hosts `keenafrica_portal_prod` alongside three sibling databases,
sharing the cluster-wide role catalog and instance-level resources
(`max_connections`, WAL, checkpoint I/O, buffer pool). All four were
re-confirmed live on 2026-09-05 by querying `pg_database` on `postgres01`
directly:

| Database | Size | Owner | State |
|---|---|---|---|
| `keenafrica_portal_prod` | 14 MB | `kf_portal_prod_migrator` | **Live production.** The only database `DATABASE_URL` points at. |
| `keenafrica_portal` | 9.0 MB | `keenafrica_migrator` | The pre-cutover `dev.keenafrica.com` database. Deliberately preserved for its historical data; confirmed dormant (traced via git history, `68c0eea` "Decommission dev.keenafrica.com") — nothing in the live k8s cluster references it. **Live evidence (2026-09-05)**: 5 tables total (`users`, `sponsors`, `projects`, `_prisma_migrations`, one more), 4 rows between them, and only 5 inserts / 2 updates / 1 delete in `pg_stat_user_tables` across the whole database since its `stats_reset` of 2026-07-24 — i.e. effectively no activity since the cutover. |
| `postgres` | 8.6 MB | `postgres` | The default administrative database every Postgres instance ships with. |
| `testdb` | 8.6 MB | `keen` | Untraced. No reference anywhere in this repo's history; likely unrelated VM-setup scratch, not this application's. **Live evidence (2026-09-05)**: zero ordinary tables in any non-system schema, zero write activity ever recorded in `pg_stat_user_tables`. It is genuinely empty. |

None of these three are written to by the portal application. This is a
documentation gap fix, not a change in behavior — `pg-backup.sh`/
`pg-restore.sh` below operate on `DATABASE_URL`'s target database only
(`keenafrica_portal_prod` in production), so the sibling databases were
never included or excluded by any backup decision; they simply were never
mentioned. **They are not backed up by `backup-portal-db.yml`** — that is
the correct behavior for `postgres` and `testdb`, and an accepted, now
explicit, decision for the dormant `keenafrica_portal` (its historical data
lives only on `postgres01`'s ZFS mirror, which is redundancy, not a
backup). Whether to delete the dormant `keenafrica_portal` database remains
an open, low-priority decision for whoever owns `postgres01` — deliberately
not made by Session 45, which was asked to document its existence, not to
decide its fate. If it is ever deleted, take a one-off `pg_dump` of it
first.

The self-hosted GitHub Actions runner (`keenafrica-vm`) already has network
access to the DB (used today by `deploy-portal.yml` to run
`prisma migrate deploy`) and has Docker installed. Backups run there rather
than on `postgres01` itself, so a problem on the DB host doesn't also take
out its own backups.

## Mechanism

- `scripts/backup/pg-backup.sh` — `pg_dump --format=custom` via a
  disposable **`postgres:14-alpine`** container (no client install needed on
  the host), writes a timestamped `.dump` to `$BACKUP_DIR`, sanity-checks
  the archive with `pg_restore --list`, and prunes old dumps (14 daily + 8
  weekly + 6 monthly, configurable). **The image is pinned to production's
  major version and both ends are checked** (`EXPECTED_PG_MAJOR`, default
  14): the script queries the live server's `server_version_num` and
  refuses to take a backup if either the client image or the server does
  not match. Until Session 49 it defaulted to `postgres:16-alpine` against
  a PostgreSQL 14.24 server, so every dump was written in archive format
  1.15 — which PostgreSQL 14's own `pg_restore` cannot read at all. The
  backups were fine; they were simply unreadable by the tooling an operator
  rebuilding `postgres01` would have. **If production is ever upgraded,
  change `EXPECTED_PG_MAJOR` in `pg-backup.sh`, `pg-restore.sh`,
  `test-restore-drill.sh` and `backup-portal-db.yml` together.**
- `scripts/backup/pg-restore.sh` — `pg_restore --clean --if-exists` into a
  target `DATABASE_URL`, gated behind `RESTORE_CONFIRM=yes` so it can't be
  run by accident. **Ends with `ANALYZE;` on the restored database (added by
  Session 45).** A dump carries no statistics, so every restored table comes
  up `reltuples = -1` ("never analyzed") and Postgres plans against default
  row estimates. In this schema that is not cosmetic: the RLS policies nest
  `EXISTS` subqueries 3-4 tables deep, so a default estimate multiplies out
  into a plan whose *estimated* cost crosses Postgres's `jit_above_cost` and
  triggers multi-second JIT compilation for a query returning almost nothing
  — the same mechanism as the Session 31 production P0. Measured on live
  production 2026-09-06: an unfiltered `SELECT id FROM assets` (6 rows) took
  **15,399 ms and JIT-compiled 4,796 functions** before `ANALYZE`, and
  **10.9 ms** after. Without this step a disaster-recovery restore would come
  up pathological and stay that way, since autoanalyze never fires below 50
  changed rows. A full-database `ANALYZE` costs ~1 second. Any other
  bulk-load or purge path (e.g. Session 48's planned production data purge)
  must do the same. **Also re-applies the app role's grants and survives
  `pg_restore`'s ignorable-error exit (Session 49)** — see the two
  paragraphs below.
- `scripts/backup/test-restore-drill.sh` — the same two scripts run
  end-to-end against **disposable, local-only** Postgres containers (now on
  production's major version): spins up a source DB, applies real
  migrations, inserts a marker row, backs it up, spins up a second empty
  "disaster" DB, **creates the production role names and a database owned
  by the migrator role**, restores into it **as the migrator role**, and
  asserts the marker row, the RLS policies, **the app role's ability to
  actually read a table**, the statistics and the `jit=off` setting all
  survived. Never touches a shared database. **Session 49 rewrote it**: it
  previously restored as the Postgres superuser, which bypasses privileges
  entirely, so it passed happily for months against a procedure that
  produced a database the portal could not read a single row from. A drill
  that does not use the role the application uses is not a drill.
- `.github/workflows/backup-portal-db.yml` — runs `pg-backup.sh` against
  prod daily (02:17 UTC) using the `PORTAL_DATABASE_URL_PROD` secret, then
  immediately restores the fresh dump into a throwaway container **the way
  a real disaster recovery would** — production's Postgres major version,
  production's role names, restored as the migrator role — and asserts the
  RLS policies, the app role's grants, and that **`kf_portal_prod_app`
  itself can read a table**. Rewritten by Session 49, which changed three
  things:
  - **No `environment: production`.** That environment carries a
    required-reviewer gate, which is right for a deploy and wrong for a
    read-only scheduled dump: four of eleven scheduled runs never executed
    at all, waiting for an approval nobody knew to give (one for 213
    hours), so four days had no backup. Checked before removing it —
    `PORTAL_DATABASE_URL_PROD` is a **repository** secret, not an
    environment secret, so nothing here ever depended on the environment
    for access. The gate stays on `deploy-portal.yml` and
    `rollback-portal.yml`.
  - **The readiness check polls the real server, not the init server.** It
    used to `docker exec pg_isready`, which answers during the postgres
    image's temporary unix-socket-only init server, so the next command
    could land before the database existed or while that temp server was
    shutting down — the cause of all three verification failures. It now
    waits for a successful query over the **mapped TCP port**, which the
    init server cannot answer.
  - **A genuine failure opens a GitHub issue** (or comments on the open
    one, so a week of failures is one thread). "A failed run is the alert"
    was the previous design; three failed runs and four that never started
    went unnoticed for eleven days. This deliberately reuses GitHub rather
    than standing up a new alerting integration — that decision is still
    open, see `PRODUCTION_HARDENING.md`.

  **A backup that fails to restore still fails the workflow** — but the
  failure is now raised somewhere a human sees, and the restore it verifies
  is the one a real recovery would perform.

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

## What a dump does NOT contain

Read this before the runbook — every disaster-recovery defect Session 47
found was an instance of it. `pg_dump` captures a database's *contents*.
Four things the portal depends on live outside that boundary and must be
reconstructed separately:

| Not in the dump | Why | Who restores it |
|---|---|---|
| **Roles** (`kf_portal_prod_migrator`, `kf_portal_prod_app`) | Cluster-level, not database-level | **You**, before restoring — step 2 below |
| **Grants and `ALTER DEFAULT PRIVILEGES`** | Dumped with `--no-privileges`; default privileges are per-database catalog state (`pg_default_acl`) | `pg-restore.sh`, automatically |
| **Planner statistics** | Never included in a dump | `pg-restore.sh`, automatically (`ANALYZE`) |
| **Database-level settings** (`jit=off`) | A property of the database object, not its contents | `pg-restore.sh`, automatically |

The last three are automatic since Sessions 45/46/49. **The roles are not,
and cannot be** — they need passwords this repo does not hold. On genuinely
fresh infrastructure, creating them is step 2 and the restore refuses to
finish without them.

## Restore runbook (real incident)

Two shapes of incident, and they are not the same:

- **In-place** (bad migration, bad `DELETE`) — restoring over the existing
  `keenafrica_portal_prod`, which already has its roles and privileges.
  Skip step 2's role creation; everything else applies.
- **Total loss / fresh infrastructure** (`postgres01` is gone) — the case
  backups exist for, and the case that was broken until Session 49. Step 2
  is not optional.

1. Identify the dump to restore: `ls -t /home/keen/backups/portal-db/*.dump | head -1` for
   latest, or pick an earlier one by its `portal-<UTC-timestamp>.dump` name.
2. **Prepare the target.** On fresh infrastructure this means all four of:
   - **The Postgres server is PostgreSQL 14.x** (production is 14.24).
     `pg-restore.sh` checks this and refuses on a mismatch.
   - **The roles exist**: `kf_portal_prod_migrator` (owns the database) and
     `kf_portal_prod_app` (`NOSUPERUSER`, `NOBYPASSRLS`). `~/portal-db-setup-prod.sh`
     on `postgres01` is the canonical script; it also holds their
     passwords, which are not in this repo. **A dump contains no roles.**
   - **The database exists and is owned by the migrator role** — restore
     does not create a database (`pg_restore --dbname` connects to an
     existing one):
     `CREATE DATABASE keenafrica_portal_prod OWNER kf_portal_prod_migrator;`
   - **The extensions are present**: `CREATE EXTENSION IF NOT EXISTS pgcrypto;
     CREATE EXTENSION IF NOT EXISTS citext;`. Creating them as a superuser
     (the normal case) is why `pg_restore` will report **4 ignored errors**
     — `must be owner of extension` on its `DROP EXTENSION`/`COMMENT`
     entries. That is expected and harmless; `pg-restore.sh` recognizes
     exactly those and continues. Any *other* error it reports is treated
     as a real failure.
3. Stop application traffic to that database if possible (scale the portal
   deployment to 0, or at minimum accept that in-flight writes during the
   restore window are lost).
4. Run it **as the migrator role** (not as a superuser — the grant step
   re-issues `ALTER DEFAULT PRIVILEGES FOR ROLE <the connecting role>`, so
   connecting as anything else would record the wrong owner):
   ```bash
   RESTORE_CONFIRM=yes ./scripts/backup/pg-restore.sh \
     /home/keen/backups/portal-db/portal-<timestamp>.dump \
     "$PORTAL_DATABASE_URL_PROD"
   ```
   The script then, automatically: re-applies `kf_portal_prod_app`'s grants
   (`USAGE` on `public`, `SELECT/INSERT/UPDATE/DELETE` on all tables, plus
   `ALTER DEFAULT PRIVILEGES` for future tables — the exact set
   `~/portal-db-setup-prod.sh` creates, 244 grants at 61 tables), runs
   `ANALYZE`, and sets `jit=off`. It fails loudly if the app role does not
   exist or ends up with no grants.
5. Spot-check. Do **all** of these — the last one is the one that has
   actually failed in practice:
   - row counts on `users`/`sponsors`/`projects`;
   - `SELECT count(*) FROM pg_policies;` — compare against the same query
     run on a known-good environment on the same migration set rather than
     a number written here, since it grows with every session that adds a
     policy (196 as of 2026-09-06);
   - **connect as `kf_portal_prod_app` and read a table**:
     ```bash
     psql -d "postgresql://kf_portal_prod_app:...@<host>:5432/keenafrica_portal_prod" \
       -Atc "select count(*) from users"
     ```
     It must return a number. `0` is correct outside a request — the role
     is RLS-scoped and has no session context. `ERROR: permission denied
     for table users` means the grants did not land and **the portal cannot
     serve a single row**; do not resume traffic.
6. Resume application traffic.

### Restoring a dump taken before 2026-09-06

Dumps written before Session 49's version pin are in archive format 1.15
(`pg_dump` 16), which PostgreSQL 14's `pg_restore` cannot read.
`pg-restore.sh` detects this, prints a loud `LEGACY ARCHIVE` banner, and
reads the archive with a `postgres:16-alpine` container while still
restoring into the PostgreSQL 14 target — so those backups remain
restorable. Dumps taken from 2026-09-06 onward are format 1.14 and need no
such fallback. Retention keeps monthly dumps for six months, so expect the
banner on older archives until roughly 2027-03.

## Verifying this still works

Run `./scripts/backup/test-restore-drill.sh` any time the schema, the
backup/restore scripts, or the RLS policies change — it's self-contained
(Docker only, no prod access) and takes a couple of minutes. The scheduled
workflow above also re-proves it against a real prod dump every day as a
side effect of taking the backup, and since Session 49 both of them assert
the thing that actually matters: **the `kf_portal_prod_app` role can read a
table on the restored database.**

Read `docs/GO_LIVE_READINESS.md` §12 for the transcript of the 2026-09-06
drill that first made that assertion pass, against real production data on
a fresh PostgreSQL 14.24 server.

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
- **The role passwords are not recoverable from anything in this repo.**
  Restoring onto fresh infrastructure requires `~/portal-db-setup-prod.sh`
  (on `postgres01`, and holding both passwords in plaintext — see
  `GO_LIVE_READINESS.md` N2) or the credentials from the GitHub secret. If
  `postgres01` is gone *and* nobody has the secret, the dumps are still
  restorable but the application cannot be reconnected to them until new
  roles and a new `PORTAL_DATABASE_URL_PROD` are issued. Worth folding into
  whatever offsite-copy decision gets made.
- **Backup reliability is on a seven-day clock as of 2026-09-06.** Session
  49 fixed the causes of the missed and failed runs, but "backups run
  unattended every day" is only provable by seven consecutive unattended
  successes. See `GO_LIVE_READINESS.md` §12.
