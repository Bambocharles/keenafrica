import styles from "../site.module.css";

export const metadata = {
  title: "Privacy Policy — Keen Africans",
  description: "What data Keen Africans collects, why, and how it's handled.",
};

/**
 * Starting-point Privacy Policy, describing what this codebase actually
 * collects/stores/sends today (see docs/KEEN_AFRICANS.md and
 * src/lib/articles.ts, src/lib/email-verification.ts, src/lib/mailer.ts,
 * src/lib/storage.ts) — not generic boilerplate, but still not a
 * substitute for real legal review, especially regarding GDPR if EU
 * readers register as authors (no self-service account deletion exists
 * yet — see the "Your rights" section below).
 */
export default function PrivacyPage() {
  return (
    <div className={styles.wrap}>
      <header className={styles.masthead}>
        <a href="/" className={styles.wordmark}>
          <span className={styles.mark}>K</span>
          Keen Africans
        </a>
      </header>

      <article className={styles.article}>
        <header className={styles.top}>
          <h1>Privacy Policy</h1>
          <div className={styles.byline}>
            <span>Last updated 1 September 2026</span>
          </div>
        </header>

        <div className={styles.body}>
          <h2>What we collect</h2>
          <ul>
            <li><strong>Account data:</strong> your email address and the name you register with (or, if you sign in with Google, the name and email your Google account provides).</li>
            <li><strong>Content you publish:</strong> article text, tags, and any cover image you upload — all publicly visible once published, by design.</li>
            <li><strong>Technical data:</strong> your IP address is logged against security-relevant actions (login attempts, article creation) to prevent abuse, and session cookies keep you signed in.</li>
          </ul>
          <p>We don&apos;t use advertising trackers or sell your data to third parties.</p>

          <h2>How it&apos;s used</h2>
          <ul>
            <li>To operate your account (authentication, sessions, password resets)</li>
            <li>To send you transactional email (email verification, password reset links) — never marketing email without your separate consent</li>
            <li>To display your published articles and byline publicly</li>
            <li>To detect and prevent abuse (rate limiting, spam accounts)</li>
          </ul>

          <h2>Who else touches your data</h2>
          <p>A small number of infrastructure providers process data on our behalf, only for the purposes above:</p>
          <ul>
            <li>Cloudflare R2 — stores uploaded cover images</li>
            <li>Resend — delivers transactional email (verification, password reset)</li>
            <li>Google — if you choose to sign in with Google</li>
          </ul>

          <h2>Cookies</h2>
          <p>
            We use one essential session cookie to keep you signed in. We don&apos;t use analytics or advertising
            cookies on Keen Africans today.
          </p>

          <h2>Your rights</h2>
          <p>
            You can edit or delete (archive) your own articles at any time from your dashboard. There is currently
            no self-service &quot;delete my account&quot; option — to request account deletion or a copy of your
            data, email <a href="mailto:hello@keenafrica.com">hello@keenafrica.com</a> and we&apos;ll handle it
            manually.
          </p>

          <h2>Retention</h2>
          <p>
            Account and content data is kept for as long as your account is active. Security/audit logs are kept
            separately for operational and abuse-prevention purposes.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about this policy: <a href="mailto:hello@keenafrica.com">hello@keenafrica.com</a>.
          </p>
        </div>
      </article>
    </div>
  );
}
