// Side-effect imports — registers Notifications' (Session 10) and
// Certificates' (Session 14) onDomainEvent listeners, exactly the pair
// src/instrumentation.ts loads at real server boot. The seed script is a
// standalone `tsx` process, not the Next.js server, so nothing else
// guarantees these modules are ever imported — without this, enrolling/
// messaging/grading/completing lessons below would silently create zero
// notifications and zero certificates.
import "@/lib/notifications";
import "@/lib/certificates";

import { prisma } from "@/lib/db";
import { actorFromUser } from "@/lib/test-support";
import { listMyNotifications, markNotificationRead } from "@/lib/notifications";
import { DEMO_EMAIL_DOMAIN } from "./constants";
import { createDemoIdentities } from "./identity";
import { createDemoCourses, publishDemoCourses } from "./content";
import { seedStudentActivity } from "./activity";
import { seedMessaging } from "./messaging";
import { seedSponsorData } from "./sponsor";

/** Marks roughly half of each user's own notifications read — a real read/unread mix, via the real self-scoped markNotificationRead(), not a raw prisma update. */
async function markSomeNotificationsRead(userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    const actor = await actorFromUser(userId);
    const { notifications } = await listMyNotifications(actor, { pageSize: 50 });
    for (let i = 0; i < notifications.length; i += 2) {
      await markNotificationRead(notifications[i].id, actor);
    }
  }
}

export async function runDemoSeed(): Promise<void> {
  const existingDemoUser = await prisma.user.findFirst({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } });
  if (existingDemoUser) {
    throw new Error(
      `Demo data already present (found ${existingDemoUser.email}). Run "npm run demo:reset" to wipe and recreate ` +
        "the canonical demo universe instead of seeding on top of it."
    );
  }

  console.log("[demo] creating identities (admins, troubleshooters, teachers, students, sponsor users)...");
  const identities = await createDemoIdentities();
  const adminActor = await actorFromUser(identities.admins[0].id);
  const suspendActor = await actorFromUser(identities.admins[1].id);

  console.log("[demo] creating courses, cohorts, and assessments...");
  const courses = await createDemoCourses(adminActor, identities.teachers);

  console.log("[demo] enrolling students and seeding progress/attempts/notes/bookmarks...");
  const activity = await seedStudentActivity(courses, identities.students, adminActor, suspendActor);

  console.log("[demo] publishing courses...");
  await publishDemoCourses(courses, adminActor);

  console.log("[demo] seeding messaging (announcements + direct threads)...");
  await seedMessaging(activity.cohortSummaries, adminActor);

  console.log("[demo] seeding sponsor data (sponsors, projects, milestones, metrics, documents, beneficiaries)...");
  await seedSponsorData(adminActor, identities.sponsorUsers, identities.students);

  console.log("[demo] marking a portion of notifications read for a realistic read/unread mix...");
  const allUserIds = [
    ...identities.admins.map((u) => u.id),
    ...identities.troubleshooters.map((u) => u.id),
    ...identities.teachers.map((u) => u.id),
    ...identities.students.map((u) => u.id),
    ...identities.sponsorUsers.map((u) => u.id),
  ];
  await markSomeNotificationsRead(allUserIds);

  console.log(
    `[demo] done: ${identities.admins.length} admin(s), ${identities.troubleshooters.length} troubleshooter(s), ` +
      `${identities.teachers.length} teacher(s), ${identities.students.length} student(s), ` +
      `${identities.sponsorUsers.length} sponsor user(s), ${courses.length} course(s), ` +
      `${activity.suspendedStudentIds.length} suspended student account(s).`
  );
  console.log(
    "[demo] note: the messaging/certificates/sponsor_reporting feature flags are left at their seeded " +
      "default (off) — this task never touches global platform config (other test/dev flows assume that " +
      "default). An admin can flip them at /admin/flags to see the student/sponsor-facing surfaces; all " +
      "underlying data (messages, certificates, sponsor projects) exists and is API/admin-visible either way."
  );
}
