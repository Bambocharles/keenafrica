import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listFeatureFlags } from "@/lib/feature-flags";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { toggleFeatureFlagAction } from "./actions";
import { Banner, Button, Card, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to manage feature flags (requires flags.manage).",
  update_failed: "Could not update that flag.",
};

export default async function FeatureFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  const params = await searchParams;
  const flags = await listFeatureFlags();
  const canManage = hasPermission(user, PERMISSIONS.FLAGS_MANAGE);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {params.error && <Banner>{ERROR_MESSAGES[params.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title="Feature flags" count={flags.length} />
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 12 }}>
          Flags gate functionality still owned by other sessions. Toggling one here takes effect for new
          requests within ~30s (in-process cache — see docs/FEATURE_FLAGS.md).
          {!canManage && " You have read-only access to this page."}
        </p>

        <div style={{ display: "grid", gap: "10px" }}>
          {flags.map((f) => (
            <Card
              key={f.key}
              style={{
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div>
                <div className={ui.nameCell}>{f.key}</div>
                <div className={ui.subCell}>{f.description}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <StatusBadge status={f.enabled ? "active" : "paused"} />
                {canManage && (
                  <form action={toggleFeatureFlagAction}>
                    <input type="hidden" name="key" value={f.key} />
                    <input type="hidden" name="enabled" value={String(!f.enabled)} />
                    <Button type="submit" variant={f.enabled ? "outline" : "primary"}>
                      {f.enabled ? "Disable" : "Enable"}
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
