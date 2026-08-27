import { orgActorFromUser } from "@/lib/test-support";
import {
  acceptOrganizationMembershipInvite,
  approveJoinRequest,
  createOrganization,
  inviteToOrganization,
  listOrganizationMembers,
  requestToJoinOrganization,
  suspendMembership,
} from "@/lib/organizations";
import type { DemoUserRef } from "./identity";
import { DEMO_ORGANIZATION_NAMES } from "./constants";

/**
 * Organization Core (Session 17) demo data — reuses existing demo teacher/
 * student identities as members rather than inventing new demo accounts
 * (CLAUDE_BUILD_RULES.md §10). Two organizations, exercising every
 * membership status the lifecycle supports (CLAUDE_BUILD_RULES.md §10's
 * "realistic states"):
 *
 *   Baobab Learning Hub (training_center):
 *     - teachers[0] — org_admin, active (the founder)
 *     - teachers[1] — org_member, active (invited as a known existing
 *       user, then accepted)
 *     - students[0] — org_member, active (requested to join, approved)
 *     - students[1] — org_member, pending (requested to join, awaiting
 *       approval — deliberately left unapproved)
 *     - students[2] — org_member, suspended (was active, then suspended)
 *
 *   Sahel Community School (school):
 *     - teachers[3] — org_admin, active (the founder)
 *     - students[0] — org_member, active (the SAME student as above,
 *       proving "a user with memberships in two organizations sees only
 *       what each grants" — session 17's own acceptance criterion)
 *     - students[3] — org_member, active
 *
 * Every transition goes through the real src/lib/organizations.ts
 * functions (never a raw prisma write), the same "seed through the actual
 * authorized API" convention this demo module's sponsor.ts/content.ts
 * siblings already use — proves the lifecycle end-to-end, not just that
 * rows exist.
 */
export async function seedOrganizations(teachers: DemoUserRef[], students: DemoUserRef[]): Promise<void> {
  const founder1 = await orgActorFromUser(teachers[0].id);
  const org1 = await createOrganization(
    {
      name: DEMO_ORGANIZATION_NAMES[0],
      slug: "baobab-learning-hub",
      type: "training_center",
      description: "A community training center offering digital and financial literacy courses.",
      contactEmail: teachers[0].email,
    },
    founder1
  );

  const invite = await inviteToOrganization(org1.id, teachers[1].email, "org_member", await orgActorFromUser(teachers[0].id));
  if (invite.mode === "existing_user") {
    await acceptOrganizationMembershipInvite(invite.membershipId, await orgActorFromUser(teachers[1].id));
  }

  await requestToJoinOrganization(org1.id, await orgActorFromUser(students[0].id));
  const student0Pending = (await listOrganizationMembers(org1.id, await orgActorFromUser(teachers[0].id))).find((m) => m.userId === students[0].id)!;
  await approveJoinRequest(student0Pending.membershipId, await orgActorFromUser(teachers[0].id));

  // students[1] stays pending on purpose — an unapproved join request is
  // itself a realistic state (CLAUDE_BUILD_RULES.md §10).
  await requestToJoinOrganization(org1.id, await orgActorFromUser(students[1].id));

  await requestToJoinOrganization(org1.id, await orgActorFromUser(students[2].id));
  const student2Pending = (await listOrganizationMembers(org1.id, await orgActorFromUser(teachers[0].id))).find((m) => m.userId === students[2].id)!;
  await approveJoinRequest(student2Pending.membershipId, await orgActorFromUser(teachers[0].id));
  await suspendMembership(student2Pending.membershipId, await orgActorFromUser(teachers[0].id));

  const founder2 = await orgActorFromUser(teachers[3].id);
  const org2 = await createOrganization(
    {
      name: DEMO_ORGANIZATION_NAMES[1],
      slug: "sahel-community-school",
      type: "school",
      description: "A community school running after-school digital literacy programs.",
      contactEmail: teachers[3].email,
    },
    founder2
  );

  // students[0] joins a SECOND organization — proves multi-org membership
  // (session 17's own acceptance criterion: "a user with memberships in
  // two organizations seeing only what each grants").
  await requestToJoinOrganization(org2.id, await orgActorFromUser(students[0].id));
  const student0InOrg2Pending = (await listOrganizationMembers(org2.id, await orgActorFromUser(teachers[3].id))).find((m) => m.userId === students[0].id)!;
  await approveJoinRequest(student0InOrg2Pending.membershipId, await orgActorFromUser(teachers[3].id));

  await requestToJoinOrganization(org2.id, await orgActorFromUser(students[3].id));
  const student3Pending = (await listOrganizationMembers(org2.id, await orgActorFromUser(teachers[3].id))).find((m) => m.userId === students[3].id)!;
  await approveJoinRequest(student3Pending.membershipId, await orgActorFromUser(teachers[3].id));
}
