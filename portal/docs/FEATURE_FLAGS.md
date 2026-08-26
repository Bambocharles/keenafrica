# Feature flags

Backing table: `feature_flags` (`key` PK, `description`, `enabled`, timestamps).
RLS: public read, super-admin-only write — see
`prisma/migrations/20260826120000_add_feature_flags/migration.sql`. Flags are
switches for functionality, not secrets, so unauthenticated reads are fine
(e.g. a public tenant page deciding whether to render a not-yet-launched
section).

## Checking a flag

```ts
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";

if (await isFeatureEnabled(FEATURE_FLAGS.MESSAGING)) {
  // render/allow the feature
}
```

- Always check server-side (Server Component, Server Action, or route
  handler). Hiding a UI element client-side is not authorization and is not
  a flag check — see CLAUDE_BUILD_RULES.md §5/§8.
- The helper caches each key in-process for 30s to avoid a DB round-trip per
  request. A toggle takes up to 30s to propagate to a given server instance.

## Adding a new flag

1. Add the key to `FEATURE_FLAGS` in `src/lib/feature-flags.ts`.
2. Add its default row (`enabled: false`) to
   `prisma/seed/tasks/feature-flags.ts`.
3. Run `npm run seed` (or apply in staging/prod via the same task, or a
   one-off `INSERT`) to materialize the row.
4. Gate the feature behind `isFeatureEnabled()` at the point where it would
   otherwise execute or render.

Do not read `process.env` directly for a flag that's meant to be toggled at
runtime without a redeploy — that defeats the point. `FEATURE_FLAG_OVERRIDES`
(a JSON object of key→boolean) is a local-dev/test-only escape hatch for
running the app before a `feature_flags` table exists locally; it is not a
second flag mechanism.

## Toggling a flag

Session 03 built the admin UI: `/flags` in the admin console, gated by the
`flags.manage` permission (`src/lib/feature-flags.ts`'s `setFeatureFlag()`,
`src/app/admin/(protected)/flags/**`). See `docs/ADMIN_CONSOLE.md`.

Direct SQL still works as a fallback (e.g. no admin account provisioned
yet in a fresh environment):

```sql
UPDATE feature_flags SET enabled = true WHERE key = 'messaging';
```

## Current flags

| key | default | governs |
|---|---|---|
| `messaging` | off | platform messaging (Session 09) |
| `certificates` | off | certificate issuance (Session 14) |
| `sponsor_reporting` | off | sponsor-facing impact/reporting views (Session 12) |
| `adaptive_recommendations` | off | adaptive learning recommendations (Session 08) |
| `ai_tutoring` | off | AI tutoring assistant (future) |
| `utme_features` | off | future UTME-specific features (future) |
