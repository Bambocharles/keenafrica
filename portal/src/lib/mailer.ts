/**
 * Transactional email is NOT built by this session — there is no SMTP/
 * provider credential anywhere in this infra yet (see docs/ENVIRONMENT.md's
 * env var table: no MAIL_* / SMTP_* / provider API key exists). Sending a
 * password reset link requires one.
 *
 * This is a dev-only stub so the reset flow is runnable/testable end to
 * end today. Wiring a real provider (choice of provider, API key, sender
 * domain/DKIM setup) is an infra decision outside Identity & Security's
 * authority to make unilaterally — see status/project-status.md's Session
 * 02 handoff, "Blockers".
 *
 * Contract for whoever picks this up: implement sendMail() against a real
 * provider behind this same signature; every caller (password-reset today,
 * future invite/notification flows) already goes through it.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No transactional email provider is configured — sendMail() is a dev-only stub. " +
        "See src/lib/mailer.ts."
    );
  }
  // eslint-disable-next-line no-console
  console.log(`[mailer:dev-stub] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
}
