import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyArticles } from "@/lib/articles";
import { isEmailVerified } from "@/lib/email-verification";
import { resendVerificationAction } from "../articles/actions";
import { Banner, Button, Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  action_failed: "Something went wrong.",
};

export default async function KeenAfricansDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; verification?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  const { error, verification } = await searchParams;
  const [articles, verified] = await Promise.all([listMyArticles(user), isEmailVerified(user.id)]);
  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}
      {verification === "sent" && <Banner variant="success">Verification email sent — check your inbox.</Banner>}

      {!verified && (
        <Card style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <div className={ui.nameCell}>Verify your email to publish</div>
            <div className={ui.subCell}>
              You can draft and preview freely. Publishing your first article requires a verified email address —
              this keeps the public site spam- and impersonation-resistant.
            </div>
          </div>
          <form action={resendVerificationAction}>
            <Button type="submit" variant="outline">
              Resend verification email
            </Button>
          </form>
        </Card>
      )}

      <section>
        <SectionHeader
          title="Your articles"
          count={articles.length}
          action={
            <a href="/articles/new" style={{ textDecoration: "none" }}>
              <Button type="button">New article</Button>
            </a>
          }
        />

        {articles.length === 0 ? (
          <EmptyState title="No articles yet" hint="Start your first draft — it only takes a title to begin." />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {articles.map((a) => (
              <Card key={a.id} style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <div className={ui.nameCell}>{a.title || "(untitled)"}</div>
                  <div className={ui.subCell}>
                    Updated {new Date(a.updatedAt).toLocaleDateString()}
                    {a.status === "published" && (
                      <>
                        {" "}
                        &middot;{" "}
                        <a href={`https://keenafricans.${rootDomain}/articles/${a.slug}`} target="_blank" rel="noreferrer">
                          view live ↗
                        </a>
                      </>
                    )}
                    {a.moderationNote && <> &middot; moderator note: {a.moderationNote}</>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <StatusBadge status={a.status} />
                  <a href={`/articles/${a.id}/edit`} style={{ textDecoration: "none" }}>
                    <Button type="button" variant="outline">
                      Edit
                    </Button>
                  </a>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
