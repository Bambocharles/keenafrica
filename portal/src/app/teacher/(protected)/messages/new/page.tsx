import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listMessageableStudentsForTeacher, listMyBroadcastCohorts } from "@/lib/messaging";
import { Banner, Button, Card, Field, Select, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { broadcastToCohortAction, startDirectConversationAction, startGroupConversationAction } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Choose at least one recipient and write a message.",
  not_authorized: "You may only message your own students or cohorts.",
  unsupported_file_type: "That attachment type isn't supported, or its content didn't match its extension.",
  file_too_large: "That attachment is too large.",
  action_failed: "That action could not be completed.",
};

export default async function NewTeacherConversationPage({
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
  const [students, cohorts] = await Promise.all([
    listMessageableStudentsForTeacher(actor),
    listMyBroadcastCohorts(actor),
  ]);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/messages" className={ui.linkMono}>
        ← Messages
      </a>
      <SectionHeader title="New message" count={0} />
      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <Card style={{ padding: "18px", display: "grid", gap: "12px" }}>
        <strong>Message a student</strong>
        {students.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>No students enrolled in your cohorts yet.</p>
        ) : (
          <form action={startDirectConversationAction} style={{ display: "grid", gap: "10px" }}>
            <Field label="Student">
              <Select name="recipientId" defaultValue="" required>
                <option value="" disabled>
                  Choose a student…
                </option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.email}) — {s.cohorts.map((c) => c.name).join(", ")}
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
        <strong>Message selected students (group)</strong>
        {students.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>No students enrolled in your cohorts yet.</p>
        ) : (
          <form action={startGroupConversationAction} style={{ display: "grid", gap: "10px" }}>
            <Field label="Students (select two or more)">
              <select name="recipientIds" multiple required size={Math.min(8, students.length)} className={ui.input}>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.email})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Message">
              <textarea name="body" required rows={4} className={ui.input} placeholder="Write your message…" />
            </Field>
            <Field label="Attachment (optional)">
              <input type="file" name="attachment" />
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Send to group
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card style={{ padding: "18px", display: "grid", gap: "12px" }}>
        <strong>Broadcast to a whole cohort</strong>
        {cohorts.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>You are not assigned to any cohort yet.</p>
        ) : (
          <form action={broadcastToCohortAction} style={{ display: "grid", gap: "10px" }}>
            <Field label="Cohort">
              <Select name="cohortId" defaultValue="" required>
                <option value="" disabled>
                  Choose a cohort…
                </option>
                {cohorts.map((c) => (
                  <option key={c.cohortId} value={c.cohortId}>
                    {c.cohort.course.title} — {c.cohort.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Announcement">
              <textarea name="body" required rows={4} className={ui.input} placeholder="Write your announcement…" />
            </Field>
            <Field label="Attachment (optional)">
              <input type="file" name="attachment" />
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Broadcast
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
