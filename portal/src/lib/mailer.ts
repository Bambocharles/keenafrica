/**
 * Transactional email (Session 19 — Federated Auth & Email). Chosen
 * provider: Resend (https://resend.com), driven with a plain fetch() call
 * against its REST API — no SDK dependency needed for a single "send one
 * email" call, so nothing was added to package.json for this. Configured
 * via RESEND_API_KEY/MAIL_FROM_ADDRESS (see docs/ENVIRONMENT.md); both are
 * ordinary env vars, not secrets baked into this file — actual values live
 * in the same k8s Secret (`portal-secrets`) every other credential does.
 *
 * Every existing caller (password reset, Session 18's org invitations, this
 * session's own account-linking notices) already goes through sendMail()
 * with zero call-site changes — this file is the only thing that changed.
 *
 * Local dev (and any environment without RESEND_API_KEY/MAIL_FROM_ADDRESS
 * configured) keeps the original console-log stub so `npm run dev` never
 * needs a real provider account; production requires both env vars and
 * throws immediately if either is missing, exactly like the previous
 * always-throws-in-production stub did.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendMail(message: MailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_ADDRESS;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "No transactional email provider is configured — set RESEND_API_KEY and " +
          "MAIL_FROM_ADDRESS. See src/lib/mailer.ts."
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[mailer:dev-stub] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    return;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    }),
  });

  if (!response.ok) {
    // Never include the API key in the thrown error — only the provider's
    // own response body, which does not echo request headers back.
    const body = await response.text().catch(() => "");
    throw new Error(`sendMail: Resend API request failed (${response.status}): ${body}`);
  }
}
