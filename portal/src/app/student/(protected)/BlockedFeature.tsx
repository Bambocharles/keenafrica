import { Banner } from "@/components/ui";

/**
 * Shared stub for entry points whose underlying capability doesn't exist
 * yet (Messaging/Notifications/Assessment/Certificates — Sessions 07/09/10/
 * 14). Per CLAUDE_BUILD_RULES.md §2: define the contract, report BLOCKED,
 * don't build a placeholder version of another session's owned system.
 */
export function BlockedFeature({
  title,
  ownerSession,
  contract,
}: {
  title: string;
  ownerSession: string;
  contract: string;
}) {
  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--ink)" }}>{title}</h2>
      <Banner>
        Not available yet — owned by {ownerSession}, which hasn&apos;t been built. This entry point exists and is
        wired to the contract below; once that session lands, this screen reads from it directly rather than a
        parallel system built here.
      </Banner>
      <pre
        style={{
          margin: 0,
          padding: "14px 16px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--ink-soft)",
          background: "var(--surface-sunken)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          whiteSpace: "pre-wrap",
        }}
      >
        {contract}
      </pre>
    </div>
  );
}
