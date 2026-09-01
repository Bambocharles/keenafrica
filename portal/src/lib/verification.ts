import { withRls } from "@/lib/rls";
import { actorRlsCtx } from "@/lib/courses";
import { requirePermission, PERMISSIONS, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";

/**
 * Verified Keen African (Session 40) — the LinkedIn-based hybrid
 * verification workflow. See prisma/schema.prisma's VerificationStatus/
 * KeenAfricanVerification comments and docs/KEEN_AFRICANS.md's
 * "Verification" section for the full design and the confirmation this
 * was checked against LinkedIn's current API docs (no automatic
 * ID-verification signal exists to build around — this is a real human
 * review of a connected LinkedIn profile, not an automatic badge).
 *
 * State machine:
 *
 *   (no row) --connectLinkedIn()--> linkedin_connected
 *                                          |    ^
 *                          approveVerification()  reconnectLinkedIn()
 *                                          |    |
 *                                          v    |
 *                                       verified
 *                                          |
 *                          rejectVerification() [also the "revoke" path]
 *                                          |
 *                                          v
 *                                       rejected --connectLinkedIn()--> linkedin_connected
 *
 * connectLinkedIn() is called from exactly one place — src/lib/oauth-
 * identity.ts's resolveLinkedInSignIn(), in its self-service "connect"
 * branch — never directly by a Server Action, same "not a caller-facing
 * API, the OAuth flow is the only sanctioned entrypoint" shape
 * notifications.ts's createNotification() documents for itself.
 * approveVerification()/rejectVerification() require verification.review
 * (or super_admin) — enforced here AND independently at the RLS layer
 * (keen_african_verifications_review policy), same "both layers" standard
 * every other moderation action in this codebase meets.
 */

export class VerificationNotFoundError extends Error {
  constructor(message = "No verification record for this account") {
    super(message);
    this.name = "VerificationNotFoundError";
  }
}

export class VerificationStateError extends Error {
  constructor(message = "That action isn't valid for the current verification status") {
    super(message);
    this.name = "VerificationStateError";
  }
}

// --- Self-service connect (called only from oauth-identity.ts) -----------

export interface ConnectLinkedInInput {
  providerAccountId: string;
  name: string | null;
  pictureUrl: string | null;
}

/**
 * Upserts the actor's own verification row to 'linkedin_connected',
 * snapshotting the LinkedIn identity just proven via OAuth. Always resets
 * status to 'linkedin_connected' regardless of the row's PRIOR state —
 * including from 'verified' — which is the deliberate, safe default: if a
 * verified Keen African relinks a DIFFERENT LinkedIn account, they go back
 * through review rather than silently keeping a VERIFIED badge attached to
 * an identity nobody has actually looked at. A prior rejection's
 * reviewedAt/reviewedBy/reviewNote are cleared — reconnecting starts a
 * fresh review cycle.
 *
 * RLS is the actual enforcement that this can never result in anything but
 * 'linkedin_connected' (keen_african_verifications_self_connect's WITH
 * CHECK) — this function passing a literal, non-parameterized status is
 * belt-and-suspenders on top of that, not the only guard.
 */
export async function connectLinkedIn(actor: AuthzActor, input: ConnectLinkedInInput) {
  const now = new Date();
  await withRls(actorRlsCtx(actor), (tx) =>
    tx.keenAfricanVerification.upsert({
      where: { userId: actor.id },
      create: {
        userId: actor.id,
        status: "linkedin_connected",
        linkedinProviderAccountId: input.providerAccountId,
        linkedinName: input.name,
        linkedinPictureUrl: input.pictureUrl,
        connectedAt: now,
      },
      update: {
        status: "linkedin_connected",
        linkedinProviderAccountId: input.providerAccountId,
        linkedinName: input.name,
        linkedinPictureUrl: input.pictureUrl,
        connectedAt: now,
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
      },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "verification.linkedin_connected",
    entityType: "User",
    entityId: actor.id,
  });
}

// --- Self reads ------------------------------------------------------------

/** For the /account "Identity verification" section — self-scoped, no permission required (same "always your own id" shape as getOwnProfile()). Null means never connected ("unverified" — no row is created until the first connect). */
export async function getOwnVerification(actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) => tx.keenAfricanVerification.findUnique({ where: { userId: actor.id } }));
}

// --- Reviewer queue + decisions (verification.review) ----------------------

/**
 * The reviewer-facing queue — Session 41's UI territory per this session's
 * brief ("expose them as functions/contracts... build a minimal one and
 * hand it off" since Session 41 hadn't shipped as of this session). Lists
 * every account currently awaiting review, oldest connection first.
 */
export async function listPendingVerificationReviews(actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.VERIFICATION_REVIEW);
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.keenAfricanVerification.findMany({
      where: { status: "linkedin_connected" },
      orderBy: { connectedAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
  );
}

/** Approve a pending review -> 'verified'. Only valid from 'linkedin_connected' — an already-verified or never-connected account can't be "approved" again. */
export async function approveVerification(targetUserId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.VERIFICATION_REVIEW);

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.keenAfricanVerification.findUnique({ where: { userId: targetUserId }, select: { status: true } })
  );
  if (!existing) throw new VerificationNotFoundError();
  if (existing.status !== "linkedin_connected") {
    throw new VerificationStateError(`Cannot approve from status "${existing.status}"`);
  }

  const row = await withRls(actorRlsCtx(actor), (tx) =>
    tx.keenAfricanVerification.update({
      where: { userId: targetUserId },
      data: { status: "verified", reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: null },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "verification.approved",
    entityType: "User",
    entityId: targetUserId,
  });
  emitDomainEvent("VerificationStatusChanged", { userId: targetUserId, status: "verified", actorId: actor.id });

  return row;
}

/**
 * Reject a pending review, OR revoke an already-VERIFIED account — both
 * land on 'rejected' with an audited reason. This is deliberately the same
 * function for both cases (not "reject" vs. a separate "revoke"): the
 * acceptance criterion is "grant or revoke VERIFIED," and rejecting a
 * pending review vs. revoking a granted one are the same state transition
 * with the same authorization rule, just a different starting status.
 * Never valid from 'linkedin_connected' -> ...already covered... nor from
 * a bare non-existent row.
 */
export async function rejectVerification(targetUserId: string, actor: AuthzActor, reason: string) {
  requirePermission(actor, PERMISSIONS.VERIFICATION_REVIEW);

  const trimmedReason = reason.trim().slice(0, 500);
  if (!trimmedReason) throw new Error("A reason is required");

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.keenAfricanVerification.findUnique({ where: { userId: targetUserId }, select: { status: true } })
  );
  if (!existing) throw new VerificationNotFoundError();
  if (existing.status !== "linkedin_connected" && existing.status !== "verified") {
    throw new VerificationStateError(`Cannot reject/revoke from status "${existing.status}"`);
  }

  const row = await withRls(actorRlsCtx(actor), (tx) =>
    tx.keenAfricanVerification.update({
      where: { userId: targetUserId },
      data: { status: "rejected", reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: trimmedReason },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "verification.rejected",
    entityType: "User",
    entityId: targetUserId,
    metadata: { reason: trimmedReason, previousStatus: existing.status },
  });
  emitDomainEvent("VerificationStatusChanged", {
    userId: targetUserId,
    status: "rejected",
    actorId: actor.id,
    reason: trimmedReason,
  });

  return row;
}

// --- Public read (no actor — anonymous, always allowed) --------------------

/**
 * Batch "is this user Verified" lookup for public badge rendering
 * (article bylines, profile pages) — anonymous (withRls({})), safe
 * specifically because keen_african_verifications_select's own RLS policy
 * has a narrow `status = 'verified'` public branch (the badge state IS the
 * public fact) and this function only ever selects { userId: true }, never
 * reviewedBy/reviewNote/the LinkedIn snapshot — same "RLS is row-level, the
 * application's own column selection is the other half of the guarantee"
 * pattern this codebase already documents on articles_update.
 */
export async function getVerifiedUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await withRls({}, (tx) =>
    tx.keenAfricanVerification.findMany({
      where: { userId: { in: userIds }, status: "verified" },
      select: { userId: true },
    })
  );
  return new Set(rows.map((r) => r.userId));
}
