"use client";

import { useState } from "react";
import styles from "../../site.module.css";

/**
 * Social sharing for the public article page. LinkedIn/X links are plain
 * `<a>` tags to each platform's own share-intent URL (no SDK, no tracking
 * script) — that's the only client-side piece here that ISN'T actually
 * client-side; only "Copy link" needs the browser's clipboard API, which is
 * why this one small piece is a client component rather than the whole
 * article page.
 */
export function ShareLinks({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS, older browser) — the
      // link is still visible/selectable in the address bar, so this is a
      // convenience failing quietly, not a broken feature.
    }
  }

  return (
    <div className={styles.share}>
      <span className={styles.shareLabel}>Share</span>
      <a
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.shareLink}
        aria-label="Share on LinkedIn"
      >
        LinkedIn
      </a>
      <a
        href={`https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.shareLink}
        aria-label="Share on X"
      >
        X
      </a>
      <button type="button" onClick={copyLink} className={styles.shareLink}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
