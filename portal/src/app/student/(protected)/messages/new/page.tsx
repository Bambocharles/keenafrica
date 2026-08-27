import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listMessageableForStudent } from "@/lib/messaging";
import { Banner, Button, Card, Field, Select, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { startDirectConversationAction } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Choose a recipient and write a message.",
  not_authorized: "You may only message a teacher or classmate you share a course with.",
  unsupported_file_type: "That attachment type isn't supported, or its content didn't match its extension.",
  file_too_large: "That attachment is too large.",
  action_failed: "That action could not be completed.",
};

export default async function NewStudentConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const messagingEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESSAGING);
  if (!messagingEnabled) redirect("/messages");

  const query = await searchParams;
  const { teachers, classmates } = await listMessageableForStudent(actor);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/messages" className={ui.linkMono}>
        ← Messages
      </a>
      <SectionHeader title="New message" count={0} />
      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <Card style={{ padding: "18px", display: "grid", gap: "12px" }}>
        <strong>Message a teacher</strong>
        {teachers.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>No teacher on your enrolled cohorts yet.</p>
        ) : (
          <form action={startDirectConversationAction} style={{ display: "grid", gap: "10px" }}>
            <Field label="Teacher">
              <Select name="recipientId" defaultValue="" required>
                <option value="" disabled>
                  Choose a teacher…
                </option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.email}) — {t.cohorts.map((c) => c.name).join(", ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Message">
              <textarea name="body" required rows={4} className={ui.input} placeholder="Write your message…" />
            </Field>
            <Field label="Attachment (optional)">
              <input type="file" name="attachment" />
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Send
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card style={{ padding: "18px", display: "grid", gap: "12px" }}>
        <strong>Message a classmate</strong>
        {classmates.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>No classmates found in your cohorts yet.</p>
        ) : (
          <form action={startDirectConversationAction} style={{ display: "grid", gap: "10px" }}>
            <Field label="Classmate">
              <Select name="recipientId" defaultValue="" required>
                <option value="" disabled>
                  Choose a classmate…
                </option>
                {classmates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.email}) — {c.cohorts.map((co) => co.name).join(", ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Message">
              <textarea name="body" required rows={4} className={ui.input} placeholder="Write your message…" />
            </Field>
            <Field label="Attachment (optional)">
              <input type="file" name="attachment" />
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Send
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
