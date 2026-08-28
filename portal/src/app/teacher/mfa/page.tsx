import { MfaChallenge } from "@/components/security/MfaChallenge";
import styles from "../login/login.module.css";

export default async function TeacherMfaPage({
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
