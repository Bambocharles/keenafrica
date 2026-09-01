import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { deriveExcerpt } from "@/lib/articles";
import { getPublicProfileByUsername } from "@/lib/profiles";
import { getAuthorReputation, isFollowing } from "@/lib/follows";
import { LegalFooter } from "../../LegalFooter";
import { VerificationBadge } from "../../VerificationBadge";
import { ReportForm } from "../../ReportForm";
import { FollowButton } from "../../FollowButton";
import styles from "../../site.module.css";

/**
 * Public profile page — keenafricans.<root>/u/<username>. No login
 * required, same "publicly readable, no elevated context needed" shape as
 * the article listing/reading pages (see src/lib/profiles.ts's
 * getPublicProfileByUsername() header). Lists only the author's PUBLISHED
 * articles — a draft article must never leak here regardless of who is
 * viewing (this session's own explicit rule, same as Session 34's
 * article-visibility rule).
 */
async function loadProfile(username: string) {
  const result = await getPublicProfileByUsername(username);
  if (!result) notFound();
  return result;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const result = await getPublicProfileByUsername(username);
  if (!result) return {};

  const { profile } = result;
  const description = profile.bio || `${profile.displayName} on Keen Africans.`;
  return {
    title: `${profile.displayName} — Keen Africans`,
    description,
    openGraph: { type: "profile", title: profile.displayName, description },
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ reported?: string; reportError?: string; followError?: string }>;
}) {
  const { username } = await params;
  const { profile, articles, verified } = await loadProfile(username);
  const session = await auth();
  const signedIn = canAccessKeenAfricanPortal(session?.user);
  const { reported, reportError, followError } = await searchParams;

  // Session 42 (Follow & Author Reputation Display). Public reads — safe
  // to run in parallel with everything already loaded above.
  const [reputation, viewerFollowing] = await Promise.all([
    getAuthorReputation(profile.userId),
    isFollowing(session?.user?.id, profile.userId),
  ]);

  const links: Array<{ label: string; href: string }> = [
    profile.websiteUrl ? { label: "Website", href: profile.websiteUrl } : null,
    profile.linkedinUrl ? { label: "LinkedIn", href: profile.linkedinUrl } : null,
    profile.githubUrl ? { label: "GitHub", href: profile.githubUrl } : null,
    profile.xUrl ? { label: "X", href: profile.xUrl } : null,
  ].filter((l): l is { label: string; href: string } => l !== null);

  return (
    <div className={styles.wrap}>
      <header className={styles.masthead}>
        <a href="/" className={styles.wordmark}>
          <span className={styles.mark}>K</span>
          Keen Africans
        </a>
        <a href={signedIn ? "/dashboard" : "/register"} className={styles.cta}>
          {signedIn ? "My dashboard" : "Write on Keen Africans"}
        </a>
      </header>

      <div className={styles.profileHeader}>
        {profile.avatarAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/avatars/${profile.avatarAssetId}`} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarInitials} aria-hidden>
            {initials(profile.displayName)}
          </div>
        )}
        <div>
          <h1 className={styles.profileName}>
            {profile.displayName}
            <VerificationBadge
              member={profile.emailVerified}
              verified={verified}
              featured={profile.featured}
              editorialBadge={profile.editorialBadge}
            />
          </h1>
          {(profile.profession || profile.country) && (
            <p className={styles.profileMeta}>
              {[profile.profession, profile.country].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className={styles.reputation}>
            <span className={styles.reputationStat}>
              <strong>{reputation.articleCount}</strong> {reputation.articleCount === 1 ? "article" : "articles"}
            </span>
            <span aria-hidden>·</span>
            <span className={styles.reputationStat}>
              <strong>{reputation.totalViews}</strong> {reputation.totalViews === 1 ? "view" : "views"}
            </span>
            <span aria-hidden>·</span>
            <span className={styles.reputationStat}>
              <strong>{reputation.followerCount}</strong> {reputation.followerCount === 1 ? "follower" : "followers"}
            </span>
          </p>
          <div className={styles.followRow}>
            <FollowButton
              targetUserId={profile.userId}
              isSelf={session?.user?.id === profile.userId}
              signedIn={!!session?.user}
              following={viewerFollowing}
              returnTo={`/u/${profile.username}`}
              followError={followError}
            />
          </div>
          {profile.bio && <p className={styles.profileBio}>{profile.bio}</p>}
          {links.length > 0 && (
            <div className={styles.profileLinks}>
              {links.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer ugc">
                  {l.label}
                </a>
              ))}
            </div>
          )}
          <ReportForm
            entityType="profile"
            entityId={profile.userId}
            returnTo={`/u/${profile.username}`}
            reported={reported === "1"}
            reportError={reportError}
          />
        </div>
      </div>

      <p className={styles.listTitle}>Published articles &middot; {articles.length}</p>

      {articles.length === 0 ? (
        <div className={styles.empty}>No published articles yet.</div>
      ) : (
        <div>
          {articles.map((a) => (
            <a key={a.id} href={`/articles/${a.slug}`} className={styles.card}>
              <h2 className={styles.cardTitle}>{a.title}</h2>
              <p className={styles.cardMeta}>
                {a.publishedAt && new Date(a.publishedAt).toLocaleDateString()}
              </p>
              <p className={styles.cardExcerpt}>{a.excerpt || deriveExcerpt(a.body)}</p>
            </a>
          ))}
        </div>
      )}

      <LegalFooter />
    </div>
  );
}
