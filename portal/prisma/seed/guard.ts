/**
 * Pulled out of index.ts so the safety rule (never run demo seed data
 * against production, never run it silently) is unit-testable without
 * spawning the CLI or touching a database.
 */

// Session 16 (Production Hardening) — closes a real gap flagged in
// status/project-status.md's Session 15 "Live production verification"
// entry: this function used to check only NODE_ENV/ALLOW_DEMO_SEED, never
// DATABASE_URL itself. A developer with legitimate access to
// PORTAL_DATABASE_URL_PROD who ran `ALLOW_DEMO_SEED=true npm run
// demo:reset` locally with NODE_ENV unset (as most local shells are) was
// NOT blocked by the checks above — only the complete absence of any
// automated path that does this (verified in that entry) prevented it in
// practice. `kf_portal_prod_app`/`kf_portal_prod_migrator` (see
// README.md, docs/BACKUP_RESTORE.md) are this platform's only production
// Postgres roles, and both share the `_prod_` naming convention
// deliberately — every production connection string matches it, and no
// documented non-production role does.
const PRODUCTION_DATABASE_URL_PATTERN = /_prod_/i;

export function assertDemoSeedAllowed(
  env: Record<string, string | undefined>
): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run demo seed tasks with NODE_ENV=production."
    );
  }
  if (env.DATABASE_URL && PRODUCTION_DATABASE_URL_PATTERN.test(env.DATABASE_URL)) {
    throw new Error(
      "Refusing to run demo seed tasks: DATABASE_URL looks like a production " +
        "connection string (matches the kf_portal_prod_* role naming convention)."
    );
  }
  if (env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Refusing to run demo seed tasks: set ALLOW_DEMO_SEED=true to confirm " +
        "this is a disposable development/staging database."
    );
  }
}
