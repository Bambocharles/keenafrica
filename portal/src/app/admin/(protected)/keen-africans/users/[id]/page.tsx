import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { getProfileByUserId } from "@/lib/profiles";
import { listArticlesByAuthorForAdmin } from "@/lib/articles";
import { getVerificationForAdmin, getVerifiedUserIds } from "@/lib/verification";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import {
  approveVerificationForUserAction,
  reinstateKeenAfricanAction,
  rejectVerificationForUserAction,
  setFeaturedAction,
  suspendKeenAfricanAction,
} from "../../actions";
import { Banner, Button, Card, Input, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to do that.",
  verification_reason_required: "A reason is required to reject or revoke a verification.",
  verification_not_found: "That account has no LinkedIn connection to act on.",
  invalid_verification_transition: "That account's verification status already changed — refresh and try again.",
  action_failed: "Could not complete that action.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). The
 * "view a user's profile and articles from the admin side" surface, plus
 * suspend/reinstate, grant/revoke VERIFIED, and grant/revoke Featured —
 * all thin wrappers around existing, already-permissioned functions
 * (src/lib/users.ts's suspendUser/reinstateUser, src/lib/verification.ts's
 * approveVerification/rejectVerification, src/lib/profiles.ts's
 * setProfileFeatured). No new authorization model: every action below is
 * gated exactly where it always was, this page just surfaces it in Keen
 * Africans context alongside the profile/article data an admin needs to
 * make the call.
 */
export default async function KeenAfricanUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!hasPermission(actor, PERMISSIONS.USERS_READ)) {
    return <Banner>You do not have permission to view users (requires users.read).</Banner>;
  }

  const { id } = await params;
  const { error } = await searchParams;

  const target = await getUserById(id, actor);
  if (!target) return <Banner>User not found.</Banner>;

  const canSuspend = hasPermission(actor, PERMISSIONS.USERS_SUSPEND);
  const canModerateArticles = actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE);
  const canReviewVerification = actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.VERIFICATION_REVIEW);

  const [profile, articles, verification, verifiedIds] = await Promise.all([
    getProfileByUserId(id),
    canModerateArticles ? listArticlesByAuthorForAdmin(id, actor) : Promise.resolve([]),
    canReviewVerification ? getVerificationForAdmin(id, actor) : Promise.resolve(null),
    getVerifiedUserIds([id]),
  ]);
  const isVerified = verifiedIds.has(id);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/keen-africans/users" className={ui.linkMono}>
        ← Keen Africans
      </a>

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title={target.name} count={0} />
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={target.status} />
            {target.roles.map((r) => (
              <span key={r} className={ui.roleTag}>
                {r}
              </span>
            ))}
            {isVerified && <StatusBadge status="verified" />}
            {profile?.featured && <span className={ui.roleTag}>Featured</span>}
          </div>
          <div className={ui.mono}>{target.email}</div>
          <div className={ui.mono}>Joined {formatDateTime(target.createdAt)}</div>
          {target.suspendedAt && <div className={ui.mono}>Suspended {formatDateTime(target.suspendedAt)}</div>}

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {canSuspend && target.status === "active" && (
              <form action={suspendKeenAfricanAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input type="hidden" name="userId" value={target.id} />
                <input type="text" name="reason" placeholder="Reason (optional, audited)" className={ui.input} />
                <Button type="submit" variant="danger">
                  Suspend account
                </Button>
              </form>
            )}
            {canSuspend && target.status === "suspended" && (
              <form action={reinstateKeenAfricanAction}>
                <input type="hidden" name="userId" value={target.id} />
                <Button type="submit" variant="secondary">
                  Reinstate account
                </Button>
              </form>
            )}
          </div>
          {canSuspend && (
            <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>
              Suspension is platform-wide (the same mechanism every other portal uses) — it revokes every active
              session immediately, not just Keen Africans access.
            </p>
          )}
        </Card>
      </section>

      {profile && (
        <section>
          <SectionHeader title="Profile" count={0} />
          <Card style={{ padding: "16px", display: "grid", gap: "10px" }}>
            <div className={ui.mono}>/u/{profile.username}</div>
            {profile.bio && <p>{profile.bio}</p>}
            <div className={ui.subCell}>
              {[profile.profession, profile.country].filter(Boolean).join(" · ") || "—"}
            </div>
            {canModerateArticles && (
              <form
                action={setFeaturedAction}
                style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: 6 }}
              >
                <input type="hidden" name="userId" value={target.id} />
                <input type="hidden" name="featured" value={profile.featured ? "false" : "true"} />
                <Button type="submit" variant={profile.featured ? "outline" : "secondary"}>
                  {profile.featured ? "Remove Featured" : "Mark Featured"}
                </Button>
              </form>
            )}
          </Card>
        </section>
      )}

      {canReviewVerification && (
        <section>
          <SectionHeader title="Identity verification" count={0} />
          <Card style={{ padding: "16px", display: "grid", gap: "10px" }}>
            {!verification ? (
              <p className={ui.subCell}>This account has never connected LinkedIn.</p>
            ) : (
              <>
                <StatusBadge status={verification.status} />
                <div className={ui.subCell}>
                  Connected as <strong>{verification.linkedinName ?? "(no name on file)"}</strong>
                  {verification.connectedAt && ` on ${new Date(verification.connectedAt).toLocaleDateString()}`}
                </div>
                {verification.reviewNote && <div className={ui.subCell}>Note: {verification.reviewNote}</div>}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  {verification.status === "linkedin_connected" && (
                    <form action={approveVerificationForUserAction}>
                      <input type="hidden" name="userId" value={target.id} />
                      <Button type="submit">Grant Verified</Button>
                    </form>
                  )}
                  {(verification.status === "linkedin_connected" || verification.status === "verified") && (
                    <form
                      action={rejectVerificationForUserAction}
                      style={{ display: "flex", gap: "8px", alignItems: "center" }}
                    >
                      <input type="hidden" name="userId" value={target.id} />
                      <Input
                        type="text"
                        name="reason"
                        required
                        placeholder={verification.status === "verified" ? "Reason for revoking" : "Reason for rejecting"}
                      />
                      <Button type="submit" variant="danger">
                        {verification.status === "verified" ? "Revoke Verified" : "Reject"}
                      </Button>
                    </form>
                  )}
                </div>
              </>
            )}
          </Card>
        </section>
      )}

      {canModerateArticles && (
        <section>
          <SectionHeader title="Articles" count={articles.length} />
          {articles.length === 0 ? (
            <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>No articles yet.</Card>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.id}>
                    <td className={ui.nameCell}>{a.title}</td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td className={ui.mono}>{formatDateTime(a.updatedAt)}</td>
                    <td>
                      {a.status === "published" && (
                        <a
                          className={ui.linkMono}
                          href={`https://keenafricans.${process.env.ROOT_DOMAIN ?? "keenafrica.com"}/articles/${a.slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View live ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}
    </div>
  );
}
