import styles from "../site.module.css";

export const metadata = {
  title: "Terms of Service — Keen Africans",
  description: "The terms that apply to registering, writing, and publishing on Keen Africans.",
};

/**
 * Starting-point ToS, tailored to what this platform actually does today
 * (open self-registration, author-owned content, the admin unpublish
 * safety valve) rather than generic boilerplate — not a substitute for a
 * real legal review before this matters for a dispute. See docs/
 * KEEN_AFRICANS.md.
 */
export default function TermsPage() {
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
          <h1>Terms of Service</h1>
          <div className={styles.byline}>
            <span>Last updated 1 September 2026</span>
          </div>
        </header>

        <div className={styles.body}>
          <p>
            Keen Africans is a publishing section of Keen Africa where anyone can register, write, and publish
            articles under their own name. By creating an account, you agree to the terms below.
          </p>

          <h2>Your account</h2>
          <p>
            You need a valid email address to register. You&apos;re responsible for keeping your password secure and
            for everything published under your account. You must verify your email address before your first
            article can be published — this is an anti-spam and anti-impersonation measure, not a review of your
            content.
          </p>

          <h2>Your content</h2>
          <p>
            You retain full ownership and copyright of everything you write and publish. By publishing an article,
            you grant Keen Africa a non-exclusive, worldwide license to host, display, and distribute it on this
            site (including via search engines, social previews, and RSS/syndication if those are added later). You
            can unpublish or delete your own drafts and published articles at any time from your dashboard.
          </p>
          <p>You agree not to publish content that:</p>
          <ul>
            <li>Infringes someone else&apos;s copyright, trademark, or other rights</li>
            <li>Is defamatory, harassing, or knowingly false</li>
            <li>Discloses confidential, proprietary, or client information you&apos;re not authorized to share</li>
            <li>Is illegal, or promotes illegal activity</li>
            <li>Impersonates another person or organization</li>
          </ul>

          <h2>Moderation</h2>
          <p>
            There is no pre-publish review — articles go live the moment you publish them. Keen Africa
            administrators may unpublish an article that violates these terms; when that happens, it returns to
            your own drafts (not deleted) and the action is logged with a reason you can see on your dashboard.
            Repeated or serious violations may result in account suspension.
          </p>

          <h2>Availability and changes</h2>
          <p>
            Keen Africa provides this platform on an as-is basis, with no uptime guarantee. We may change or
            discontinue features, and may update these terms — continued use after a change means you accept the
            updated terms. We&apos;ll aim to note material changes on this page.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these terms, or a request to remove content you believe violates them, can be sent to{" "}
            <a href="mailto:hello@keenafrica.com">hello@keenafrica.com</a>.
          </p>
        </div>
      </article>
    </div>
  );
}
