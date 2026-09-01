import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { deriveExcerpt } from "@/lib/articles";
import { getPublicProfileByUsername } from "@/lib/profiles";
import { LegalFooter } from "../../LegalFooter";
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
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const { profile, articles } = await loadProfile(username);
  const session = await auth();
  const signedIn = canAccessKeenAfricanPortal(session?.user);

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
            {/* Verification badge slot — deliberately empty. Session 40's
                territory (this session's own explicit "Must NOT: build
                verification/badges yet"); reserved here so that session can
                render a badge without touching this page's layout. */}
            <span data-verification-badge-slot aria-hidden />
          </h1>
          {(profile.profession || profile.country) && (
            <p className={styles.profileMeta}>
              {[profile.profession, profile.country].filter(Boolean).join(" · ")}
            </p>
          )}
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
