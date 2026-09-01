import { PROFILE_BADGE_LABELS } from "@/lib/profiles";
import type { ProfileBadge } from "@prisma/client";
import styles from "./site.module.css";

/**
 * Session 40 (Keen Africans — LinkedIn Verification). The one shared
 * renderer for both badge slots this session fills
 * (articles/[id]/page.tsx's byline, u/[username]/page.tsx's profile
 * header) — one place, so the two-tier model can never visually drift
 * between the two pages.
 *
 * Four deliberately distinct, non-conflatable treatments, per this
 * session's own "Must NOT visually conflate" rule:
 *  - `verified` (checkmark, primary color) supersedes `member` — a
 *    Verified Keen African is never ALSO shown the plain label, avoiding
 *    a confusing "Keen African · Verified Keen African ✓" double-label.
 *  - `member` (plain text, no checkmark, muted color) — anyone registered
 *    with a verified email. Establishes membership only, no identity claim.
 *  - `featured` (a small pill, distinct color and shape from the
 *    checkmark, own label "Featured") — a fully separate editorial flag,
 *    can coexist with either of the above.
 *  - `editorialBadge` (Session 42 — "Top Contributor" / "Community
 *    Mentor," a small pill styled distinctly from BOTH the checkmark AND
 *    the Featured pill: no checkmark glyph, no green tone, its own muted
 *    slate color — per sessions/42's own explicit "never let this
 *    resemble the Session 40 verification badge" rule. Profile-page-only,
 *    same precedent Session 40 already set for `featured` (neither is
 *    passed on the article byline's own VerificationBadge call).
 *
 * The verified badge's `title` attribute carries the exact public
 * explanation from this session's brief, verbatim in spirit — this is the
 * one place that copy lives, so it can never drift between pages.
 */
export function VerificationBadge({
  member,
  verified,
  featured,
  editorialBadge,
}: {
  member: boolean;
  verified: boolean;
  featured?: boolean;
  editorialBadge?: ProfileBadge | null;
}) {
  if (!member && !verified && !featured && !editorialBadge) return null;

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
      {editorialBadge && (
        <span className={styles.editorialBadge} title="An editorial recognition from the Keen Africans team">
          {PROFILE_BADGE_LABELS[editorialBadge]}
        </span>
      )}
    </>
  );
}
