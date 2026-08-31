import { MfaChallenge } from "@/components/security/MfaChallenge";
import styles from "../login/login.module.css";

/**
 * Defense-in-depth only — MFA policy (src/lib/mfa.ts's MFA_REQUIRED_ROLES)
 * covers SUPER_ADMIN only today, so a plain KEEN_AFRICAN account never
 * lands here in practice. Present anyway so the layout's
 * `session.user.mfaPending` redirect (mirrors every other portal) always
 * has a real target rather than a dead link.
 */
export default async function KeenAfricansMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ enroll?: string; codes?: string; error?: string }>;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.card} style={{ maxWidth: 460 }}>
        <div className={styles.mark}>K</div>
        <MfaChallenge searchParams={await searchParams} />
      </div>
    </div>
  );
}
