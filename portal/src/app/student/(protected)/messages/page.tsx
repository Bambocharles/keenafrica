import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { BlockedFeature } from "../BlockedFeature";

export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const flagEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESSAGING);

  return (
    <BlockedFeature
      title="Messages"
      ownerSession="Session 09 (Messaging)"
      contract={`Expected contract (see sessions/09-messaging.md):
  One canonical Conversation/Message system shared by every portal — "no
  portal-specific message database." Required use case explicitly includes
  Student -> teacher and Student -> permitted student. This page will call
  a "listMyConversations(actor)" / "sendMessage(conversationId, body, actor)"
  contract, server-side participant-authorized, once it exists — never a
  student-only messaging table built here.

  Feature flag "messaging" (src/lib/feature-flags.ts) already exists and
  currently reads: ${flagEnabled ? "ENABLED" : "disabled"} (default off).
  MessageReceived is already typed in src/lib/events.ts, unemitted.`}
    />
  );
}
