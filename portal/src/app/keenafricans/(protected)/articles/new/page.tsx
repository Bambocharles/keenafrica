import { Banner, Card, Field, Input, Button } from "@/components/ui";
import { createArticleAction } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Give your article a title to start.",
  rate_limited: "You've created several articles recently — try again in a bit.",
  action_failed: "Something went wrong.",
};

export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div style={{ maxWidth: 520 }}>
      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}
      <Card style={{ padding: "22px" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>Start a new article</h2>
        <p style={{ margin: "0 0 18px", fontSize: 12.5, color: "var(--ink-faint)" }}>
          Give it a title — you'll write the rest, add a cover image, and publish from the editor.
        </p>
        <form action={createArticleAction} style={{ display: "grid", gap: "14px" }}>
          <Field label="Title">
            <Input name="title" required autoFocus placeholder="What's this article about?" />
          </Field>
          <Button type="submit">Create draft</Button>
        </form>
      </Card>
    </div>
  );
}
