// Cloudflare Worker: handles the site contact form and the learn-app
// feedback widget. Routed at the edge for keenafrica.com/api/* (and every
// subdomain) so it never touches the origin — see ../worker.tf.
//
// Sends mail through Resend. Requires the RESEND_API_KEY secret and a
// verified sending domain (see ../../README section on setup).

const CONTACT_TO = "contact@keenafrica.com";
const FEEDBACK_TO = "learn@keenafrica.com";
const FROM = "Keen Africa Website <no-reply@keenafrica.com>";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendEmail(env, { to, subject, replyTo, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
}

async function handleContact(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid request" }, 400);

  const { name, email, reason, message, kf_hp } = body;

  // Honeypot field — real visitors never see or fill it. Deliberately named
  // and labelled to avoid matching browser/password-manager autofill
  // heuristics (a field literally named "website" gets auto-populated by
  // some autofill profiles, silently swallowing real submissions).
  if (kf_hp) return json({ ok: true });

  if (!name || !email || !message) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Invalid email" }, 400);
  }

  const html = `
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Reason:</strong> ${escapeHtml(reason || "—")}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
  `;

  try {
    await sendEmail(env, {
      to: CONTACT_TO,
      subject: `New contact form message from ${name}`,
      replyTo: email,
      html,
    });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: "Failed to send" }, 502);
  }
}

async function handleFeedback(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid request" }, 400);

  const { topic, appId, appTitle, rating, message, email, kf_hp } = body;

  // Honeypot field — real visitors never see or fill it.
  if (kf_hp) return json({ ok: true });

  if (!message || typeof message !== "string" || !message.trim()) {
    return json({ ok: false, error: "Missing message" }, 400);
  }
  if (email && !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Invalid email" }, 400);
  }

  const about = topic === "blog" ? "The blog" : "The app";
  const subjectApp = appTitle || appId || "App";

  const html = `
    <p><strong>About:</strong> ${escapeHtml(about)}${
      topic !== "blog" ? ` — ${escapeHtml(subjectApp)}` : ""
    }</p>
    ${rating ? `<p><strong>Rating:</strong> ${escapeHtml(String(rating))}/5</p>` : ""}
    <p><strong>From:</strong> ${email ? escapeHtml(email) : "Anonymous"}</p>
    <p><strong>Feedback:</strong></p>
    <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
  `;

  try {
    await sendEmail(env, {
      to: FEEDBACK_TO,
      subject: `Learn feedback: ${topic === "blog" ? "Blog" : subjectApp}`,
      replyTo: email || undefined,
      html,
    });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: "Failed to send" }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }
    const { pathname } = new URL(request.url);
    if (pathname === "/api/contact") return handleContact(request, env);
    if (pathname === "/api/feedback") return handleFeedback(request, env);
    return json({ ok: false, error: "Not found" }, 404);
  },
};
