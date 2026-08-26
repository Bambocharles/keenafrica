import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyCourses } from "@/lib/courses";
import { Banner, EmptyState, SectionHeader } from "@/components/ui";

/**
 * Entry point only — Session 09 (Messaging) owns the canonical
 * Conversation/Message tables and APIs, which do not exist yet. Per
 * CLAUDE_BUILD_RULES.md §2 ("do not invent a competing implementation"),
 * this screen does not build a parallel, portal-specific messaging system;
 * it reports the dependency and documents the contract Teacher expects to
 * consume once it lands (see docs/TEACHER.md).
 *
 * Required use cases per sessions/05-teacher.md: teacher -> individual
 * student, teacher -> selected group of students, teacher -> whole cohort.
 * The expected contract (sessions/09-messaging.md): a Conversation with a
 * participant list and a `type` ("direct" | "group" | "cohort_broadcast"),
 * created via something like `startConversation({ participantIds, type,
 * contextCohortId? }, actor)`, then `sendMessage(conversationId, body, actor)`
 * — server-side participant authorization, emitting MessageReceived
 * (already typed in src/lib/events.ts's DomainEventMap) for Notifications
 * to pick up.
 */
export default async function TeacherMessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const courses = await listMyCourses(actor);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="Messages" count={0} />

      <Banner>
        Messaging is not available yet. Session 09 (Messaging) is expected to build one canonical Conversation/
        Message system for the whole platform — Teacher will send to an individual student, a selected group, or a
        whole cohort through that shared contract rather than a portal-specific inbox. This page is the wired entry
        point (reachable from the "Messages" nav item) waiting on that dependency — reported BLOCKED rather than
        building a parallel messaging table here, per CLAUDE_BUILD_RULES.md §2/§3.
      </Banner>

      {courses.length === 0 ? (
        <EmptyState title="No courses assigned yet" />
      ) : (
        <EmptyState
          title="Your eligible recipients"
          hint={`Once messaging exists, you'll be able to reach students across your ${courses.length} course(s) and their cohorts from here.`}
        />
      )}
    </div>
  );
}
