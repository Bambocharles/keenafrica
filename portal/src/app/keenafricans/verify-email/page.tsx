import { confirmEmailVerification } from "@/lib/email-verification";
import styles from "../login/login.module.css";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const outcome = token ? await confirmEmailVerification(token) : "invalid_or_expired";

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>K</div>
        {outcome === "ok" ? (
          <>
            <h1 className={styles.title}>Email verified</h1>
            <p className={styles.subtitle}>You can now publish your articles.</p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Link invalid or expired</h1>
            <p className={styles.subtitle}>
              Verification links expire after 24 hours. Log in and resend one from your dashboard.
            </p>
          </>
        )}
        <a href="/dashboard" className={styles.submit} style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
