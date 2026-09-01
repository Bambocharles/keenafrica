import styles from "./site.module.css";

/**
 * Session 40 (Keen Africans — LinkedIn Verification). The one shared
 * renderer for both badge slots this session fills
 * (articles/[id]/page.tsx's byline, u/[username]/page.tsx's profile
 * header) — one place, so the two-tier model can never visually drift
 * between the two pages.
 *
 * Three deliberately distinct, non-conflatable treatments, per this
 * session's own "Must NOT visually conflate" rule:
 *  - `verified` (checkmark, primary color) supersedes `member` — a
 *    Verified Keen African is never ALSO shown the plain label, avoiding
 *    a confusing "Keen African · Verified Keen African ✓" double-label.
 *  - `member` (plain text, no checkmark, muted color) — anyone registered
 *    with a verified email. Establishes membership only, no identity claim.
 *  - `featured` (a small pill, distinct color and shape from the
 *    checkmark, own label "Featured") — a fully separate editorial flag,
 *    can coexist with either of the above.
 *
 * The verified badge's `title` attribute carries the exact public
 * explanation from this session's brief, verbatim in spirit — this is the
 * one place that copy lives, so it can never drift between pages.
 */
export function VerificationBadge({
  member,
  verified,
  featured,
}: {
  member: boolean;
  verified: boolean;
  featured?: boolean;
}) {
  if (!member && !verified && !featured) return null;

  return (
    <>
      {verified ? (
        <span
          className={styles.verifiedBadge}
          title="This badge confirms Keen Africa has verified the identity associated with this account via a connected LinkedIn profile. It does not mean Keen Africa endorses this person's views, employer, qualifications, or content."
        >
          Verified Keen African <span aria-hidden>✓</span>
        </span>
      ) : member ? (
        <span className={styles.memberLabel}>Keen African</span>
      ) : null}
      {featured && (
        <span className={styles.featuredBadge} title="Editorially featured by Keen Africa">
          Featured
        </span>
      )}
    </>
  );
}
