import { withRls } from "@/lib/rls";
import { PERMISSIONS, requirePermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";

/**
 * Canonical flag keys. Adding a flag means: add the key here, add a row for
 * it in prisma/seed/tasks/feature-flags.ts (defaulted to disabled), then
 * gate the feature behind isFeatureEnabled() server-side. See
 * docs/FEATURE_FLAGS.md for the full convention.
 */
export const FEATURE_FLAGS = {
  MESSAGING: "messaging",
  CERTIFICATES: "certificates",
  SPONSOR_REPORTING: "sponsor_reporting",
  ADAPTIVE_RECOMMENDATIONS: "adaptive_recommendations",
  AI_TUTORING: "ai_tutoring",
  UTME_FEATURES: "utme_features",
  // Added by Session 10 (Notifications). The in-app notification center
  // itself is NOT flag-gated (core plumbing, same as audit/progress) — only
  // delivery CHANNELS beyond in-app are, per that session's explicit
  // acceptance criterion "feature flags prevent incomplete channels from
  // exposing broken UX". NOTIFICATIONS_EMAIL has a real (dev-stub-backed,
  // see src/lib/mailer.ts) implementation behind it, default off because
  // the underlying provider is still Session 02's open blocker. The other
  // three have NO implementation at all yet (no push/SMS/WhatsApp provider
  // exists anywhere in this infra) — they're reserved keys only, same
  // pre-declared-ahead-of-the-owning-session pattern this file already uses
  // for CERTIFICATES/SPONSOR_REPORTING/AI_TUTORING. See
  // docs/NOTIFICATIONS.md's "Delivery channels" section.
  NOTIFICATIONS_EMAIL: "notifications_email",
  NOTIFICATIONS_PUSH: "notifications_push",
  NOTIFICATIONS_SMS: "notifications_sms",
  NOTIFICATIONS_WHATSAPP: "notifications_whatsapp",
} as const;

export type FeatureFlagKey =
  (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

/**
 * Local-dev/test escape hatch: FEATURE_FLAG_OVERRIDES='{"messaging":true}'
 * short-circuits the DB lookup entirely for the listed keys. Never read in
 * production decision paths beyond this — it's for running the app without
 * a seeded feature_flags table, not a real toggle mechanism.
 */
function readOverrides(): Record<string, boolean> {
  const raw = process.env.FEATURE_FLAG_OVERRIDES;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Server-side-only flag check. Flags are public-read (see migration RLS
 * policy), so this deliberately runs without a user context — callers that
 * already have one may still call withRls-scoped code around it.
 */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const overrides = readOverrides();
  if (key in overrides) return Boolean(overrides[key]);

  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const flag = await withRls({}, (tx) =>
    tx.featureFlag.findUnique({ where: { key } })
  );
  const value = flag?.enabled ?? false;
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/** Test/dev helper — clears the in-process cache between assertions. */
export function _resetFeatureFlagCache() {
  cache.clear();
}

export interface FeatureFlagSummary {
  key: string;
  description: string;
  enabled: boolean;
  updatedAt: Date;
}

/**
 * Admin console's feature-flags screen (Session 03). Public read, same as
 * isFeatureEnabled() — flags are switches for functionality, not secrets.
 */
export async function listFeatureFlags(): Promise<FeatureFlagSummary[]> {
  return withRls({}, (tx) => tx.featureFlag.findMany({ orderBy: { key: "asc" } }));
}

/**
 * Requires flags.manage — see docs/FEATURE_FLAGS.md and the
 * feature_flags_update RLS policy (20260826140000_admin_feature_flags_
 * permission), which this mirrors at the application layer. Only ever
 * toggles `enabled` on an existing row; adding/removing a flag key is a
 * code change (FEATURE_FLAGS + the seed task), not a runtime action.
 */
export async function setFeatureFlag(key: FeatureFlagKey, enabled: boolean, actor: AuthzActor): Promise<void> {
  requirePermission(actor, PERMISSIONS.FLAGS_MANAGE);

  await withRls(
    { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] },
    (tx) => tx.featureFlag.update({ where: { key }, data: { enabled } })
  );

  cache.delete(key);

  await recordAuditEvent({
    actorId: actor.id,
    action: "feature_flag.updated",
    entityType: "FeatureFlag",
    entityId: key,
    metadata: { enabled },
  });
}
