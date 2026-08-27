import type { AuthzActor } from "@/lib/authz";
import { actorFromUser } from "@/lib/test-support";
import { startConversation, sendMessage, markConversationRead } from "@/lib/messaging";
import type { CohortActivitySummary } from "./activity";

/**
 * Messaging (Session 09) demo activity — teacher cohort announcements plus
 * direct teacher/student threads, some answered-and-read, some answered-
 * and-unread, one left unanswered entirely, and one admin -> student
 * message (the `messages.admin` bypass). All through the real
 * startConversation/sendMessage API, so the relationship check
 * (assertCanMessage) is exercised by construction, not assumed.
 */
export async function seedMessaging(
  cohortSummaries: CohortActivitySummary[],
  adminActor: AuthzActor
): Promise<void> {
  for (let i = 0; i < cohortSummaries.length; i++) {
    const summary = cohortSummaries[i];
    const teacherActor = await actorFromUser(summary.primaryTeacherId);

    await startConversation(
      {
        type: "cohort_broadcast",
        cohortId: summary.cohortId,
        body: "Welcome to the cohort! Check the first module this week, and reach out here if anything is unclear.",
      },
      teacherActor
    );

    // Thread 1: an active student asks a question; the teacher replies.
    // Every other cohort has the student read the reply — a real read/
    // unread split, not a hand-set flag.
    const activeStudentActor = await actorFromUser(summary.sampleActiveStudentId);
    const thread1 = await startConversation(
      { type: "direct", participantIds: [summary.primaryTeacherId], body: "Hi! Quick question about the first lesson — is there a recommended amount of time to spend on it?" },
      activeStudentActor
    );
    await sendMessage(
      thread1.conversation.id,
      { body: "Great question — aim for about 20-30 minutes, then revisit the resource link if anything didn't stick." },
      teacherActor
    );
    if (i % 2 === 0) {
      await markConversationRead(thread1.conversation.id, activeStudentActor);
    }

    // Thread 2: a nearly-complete student asks something the teacher hasn't
    // gotten to yet — a genuinely unanswered/unread thread.
    const nearlyCompleteStudentActor = await actorFromUser(summary.sampleNearlyCompleteStudentId);
    await startConversation(
      { type: "direct", participantIds: [summary.primaryTeacherId], body: "Hi, will the assessment be open again if I want to retake it for a better score?" },
      nearlyCompleteStudentActor
    );
  }

  // One admin -> student message, demonstrating the messages.admin
  // relationship-check bypass (an admin can message any user).
  if (cohortSummaries.length > 0) {
    await startConversation(
      {
        type: "direct",
        participantIds: [cohortSummaries[0].sampleActiveStudentId],
        body: "Hi! This is a reminder from the Keen Africa team — keep up the great progress in your course.",
      },
      adminActor
    );
  }
}
