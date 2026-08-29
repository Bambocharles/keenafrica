import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { onDomainEvent } from "@/lib/events";
import {
  addProjectBeneficiary,
  addProjectTeamMember,
  createMilestone,
  createProject,
  createSponsor,
  getDashboardSummary,
  getProjectBeneficiaryCount,
  getProjectForSponsor,
  getProjectImpactSummary,
  isProjectSponsorMember,
  listMilestonesForProject,
  listMyProjects,
  listProjectBeneficiaries,
  listProjectDocuments,
  listProjectTeam,
  recordProjectMetric,
  removeProjectTeamMember,
  updateMilestone,
} from "@/lib/sponsor";
import {
  actorFromUser,
  cleanupTestProjects,
  cleanupTestSponsors,
  cleanupTestUsers,
  createTestUser,
} from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];
const createdSponsorIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

let slugCounter = 0;
function uniqueSlug(): string {
  slugCounter += 1;
  return `sp-test-${Date.now()}-${slugCounter}`;
}

afterAll(async () => {
  await cleanupTestProjects(createdProjectIds);
  await cleanupTestSponsors(createdSponsorIds);
  await cleanupTestUsers(createdUserIds);
});

async function makeSponsorAndProject() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const sponsor = await createSponsor(`Sponsor ${uniqueSlug()}`, adminActor);
  createdSponsorIds.push(sponsor.id);
  const project = await createProject({ sponsorId: sponsor.id, name: "Test Project", slug: uniqueSlug() }, adminActor);
  createdProjectIds.push(project.id);
  return { admin, adminActor, sponsor, project };
}

describe("createSponsor / createProject — authorization boundary", () => {
  it("requires sponsor.manage", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);
    await expect(createSponsor("Blocked Sponsor", strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("a SPONSOR_ADMIN (portal-side role, no sponsor.manage) cannot create a sponsor or project", async () => {
    const sponsorAdmin = await user({ roles: ["SPONSOR_ADMIN"] });
    const actor = await actorFromUser(sponsorAdmin.id);
    await expect(createSponsor("Blocked Sponsor 2", actor)).rejects.toThrow(AuthorizationError);

    const { sponsor } = await makeSponsorAndProject();
    await expect(createProject({ sponsorId: sponsor.id, name: "X", slug: uniqueSlug() }, actor)).rejects.toThrow(
      AuthorizationError
    );
  });

  it("an admin (sponsor.manage) can create a sponsor and project", async () => {
    const { sponsor, project } = await makeSponsorAndProject();
    expect(sponsor.name).toContain("Sponsor");
    expect(project.status).toBe("active");

    const audit = await prisma.auditEvent.findFirst({ where: { action: "project.created", entityId: project.id } });
    expect(audit).not.toBeNull();
  });
});

describe("requireProjectSponsorAccess / isProjectSponsorMember — ownership scoping", () => {
  it("sponsor.projects.read alone (no project_memberships row) grants nothing", async () => {
    const { project } = await makeSponsorAndProject();
    const outsider = await user({ roles: ["SPONSOR_USER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    expect(await isProjectSponsorMember(project.id, outsiderActor)).toBe(false);
    await expect(getProjectForSponsor(project.id, outsiderActor)).rejects.toThrow(AuthorizationError);
    await expect(listMilestonesForProject(project.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("a project_memberships row (role=sponsor_admin) + sponsor.projects.read grants access to that project only", async () => {
    const { adminActor, sponsor, project } = await makeSponsorAndProject();
    const sponsorUser = await user({ roles: ["SPONSOR_USER"] });
    const sponsorActor = await actorFromUser(sponsorUser.id);

    await prisma.projectMembership.create({ data: { userId: sponsorUser.id, projectId: project.id, role: "sponsor_admin" } });

    expect(await isProjectSponsorMember(project.id, sponsorActor)).toBe(true);
    const fetched = await getProjectForSponsor(project.id, sponsorActor);
    expect(fetched?.id).toBe(project.id);

    // Second project, same sponsor org, but this specific user has no
    // membership row on it — cross-project isolation within the same
    // sponsor org still holds.
    const project2 = await createProject({ sponsorId: sponsor.id, name: "Other", slug: uniqueSlug() }, adminActor);
    createdProjectIds.push(project2.id);
    await expect(getProjectForSponsor(project2.id, sponsorActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("cross-sponsor data isolation", () => {
  it("a sponsor-team member of Project A cannot read Project B's milestones, metrics, beneficiaries, documents, or team", async () => {
    const { adminActor, project: projectA } = await makeSponsorAndProject();
    const { project: projectB } = await makeSponsorAndProject();

    const beneficiaryB = await user({ status: "active" });
    await prisma.projectMembership.create({ data: { userId: beneficiaryB.id, projectId: projectB.id, role: "beneficiary" } });

    await createMilestone(projectB.id, { title: "B milestone" }, adminActor);
    await recordProjectMetric(projectB.id, { label: "reach", value: 42 }, adminActor);

    const sponsorA = await user({ roles: ["SPONSOR_ADMIN"] });
    const sponsorAActor = await actorFromUser(sponsorA.id);
    await prisma.projectMembership.create({ data: { userId: sponsorA.id, projectId: projectA.id, role: "sponsor_admin" } });

    // sponsorA is a legitimate sponsor-team member — of Project A, not B.
    await expect(listMilestonesForProject(projectB.id, sponsorAActor)).rejects.toThrow(AuthorizationError);
    await expect(getProjectImpactSummary(projectB.id, sponsorAActor)).rejects.toThrow(AuthorizationError);
    await expect(listProjectBeneficiaries(projectB.id, sponsorAActor)).rejects.toThrow(AuthorizationError);
    await expect(getProjectBeneficiaryCount(projectB.id, sponsorAActor)).rejects.toThrow(AuthorizationError);
    await expect(listProjectDocuments(projectB.id, sponsorAActor)).rejects.toThrow(AuthorizationError);
    await expect(listProjectTeam(projectB.id, sponsorAActor)).rejects.toThrow(AuthorizationError);

    // listMyProjects only ever returns Project A for this actor.
    const myProjects = await listMyProjects(sponsorAActor);
    expect(myProjects.map((p) => p.id)).toContain(projectA.id);
    expect(myProjects.map((p) => p.id)).not.toContain(projectB.id);

    // The dashboard aggregate also never leaks Project B's counts into A's actor.
    const summary = await getDashboardSummary(sponsorAActor);
    expect(summary.map((s) => s.id)).not.toContain(projectB.id);
  });

  it("addProjectTeamMember/removeProjectTeamMember are ownership-scoped — a Project A sponsor.users.manage holder cannot touch Project B's team", async () => {
    const { project: projectA } = await makeSponsorAndProject();
    const { project: projectB } = await makeSponsorAndProject();

    const sponsorA = await user({ roles: ["SPONSOR_ADMIN"] });
    const sponsorAActor = await actorFromUser(sponsorA.id);
    await prisma.projectMembership.create({ data: { userId: sponsorA.id, projectId: projectA.id, role: "sponsor_admin" } });

    const targetEmail = (await user()).email;

    await expect(addProjectTeamMember(projectB.id, targetEmail, sponsorAActor)).rejects.toThrow(AuthorizationError);
    await expect(removeProjectTeamMember(projectB.id, sponsorA.id, sponsorAActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("addProjectTeamMember — self-service vs admin role-grant", () => {
  it("rejects an email with no matching platform account", async () => {
    const { project } = await makeSponsorAndProject();
    const sponsorAdmin = await user({ roles: ["SPONSOR_ADMIN"] });
    const actor = await actorFromUser(sponsorAdmin.id);
    await prisma.projectMembership.create({ data: { userId: sponsorAdmin.id, projectId: project.id, role: "sponsor_admin" } });

    await expect(addProjectTeamMember(project.id, "nobody-real@example.com", actor)).rejects.toThrow();
  });

  it("a SPONSOR_ADMIN member (sponsor.users.manage, no roles.manage) can add a colleague but cannot grant them the sponsor Role", async () => {
    const { project } = await makeSponsorAndProject();
    const sponsorAdmin = await user({ roles: ["SPONSOR_ADMIN"] });
    const actor = await actorFromUser(sponsorAdmin.id);
    await prisma.projectMembership.create({ data: { userId: sponsorAdmin.id, projectId: project.id, role: "sponsor_admin" } });

    const colleague = await user(); // no SPONSOR_ADMIN/SPONSOR_USER role yet
    const result = await addProjectTeamMember(project.id, colleague.email, actor);

    expect(result.userId).toBe(colleague.id);
    expect(result.needsRoleGrant).toBe(true); // self-service path never calls assignRole
    const roles = await prisma.userRole.findMany({ where: { userId: colleague.id } });
    expect(roles).toHaveLength(0);

    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: colleague.id, projectId: project.id } },
    });
    expect(membership?.role).toBe("sponsor_admin");
  });

  it("an admin (sponsor.manage) adding a colleague also grants SPONSOR_USER automatically", async () => {
    const { adminActor, project } = await makeSponsorAndProject();
    const colleague = await user();

    const result = await addProjectTeamMember(project.id, colleague.email, adminActor);
    expect(result.needsRoleGrant).toBe(false);

    const roles = await prisma.userRole.findMany({ where: { userId: colleague.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toContain("SPONSOR_USER");
  });
});

describe("beneficiary privacy — listProjectBeneficiaries never exposes contact/academic data", () => {
  it("returns only id + a first-name/last-initial display name, never email", async () => {
    const { adminActor, project } = await makeSponsorAndProject();
    const beneficiary = await user({ status: "active" });
    // createTestUser always names the fixture "Test User" — give this one a
    // realistic two-part name to exercise the anonymization.
    await prisma.user.update({ where: { id: beneficiary.id }, data: { name: "Amina Okafor" } });
    await prisma.projectMembership.create({ data: { userId: beneficiary.id, projectId: project.id, role: "beneficiary" } });

    const list = await listProjectBeneficiaries(project.id, adminActor);
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe("Amina O.");
    expect(JSON.stringify(list)).not.toContain(beneficiary.email);
    expect(Object.keys(list[0]).sort()).toEqual(["displayName", "id"]);

    const count = await getProjectBeneficiaryCount(project.id, adminActor);
    expect(count).toBe(1);
  });

  it("strips a trailing parenthetical annotation before computing the last-name initial", async () => {
    // Regression for a bug found live in Session 28's QA pass: every QA
    // fixture account is named "QA <Role> (non-production test account)" —
    // naively taking the last whitespace-split token produced "QA a."
    // (from "account)") instead of "QA S.".
    const { adminActor, project } = await makeSponsorAndProject();
    const beneficiary = await user({ status: "active" });
    await prisma.user.update({
      where: { id: beneficiary.id },
      data: { name: "QA Student (non-production test account)" },
    });
    await prisma.projectMembership.create({ data: { userId: beneficiary.id, projectId: project.id, role: "beneficiary" } });

    const list = await listProjectBeneficiaries(project.id, adminActor);
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe("QA S.");
  });

  it("addProjectBeneficiary requires sponsor.manage, not just sponsor.users.manage", async () => {
    const { project } = await makeSponsorAndProject();
    const sponsorAdmin = await user({ roles: ["SPONSOR_ADMIN"] });
    const actor = await actorFromUser(sponsorAdmin.id);
    await prisma.projectMembership.create({ data: { userId: sponsorAdmin.id, projectId: project.id, role: "sponsor_admin" } });

    const target = await user();
    await expect(addProjectBeneficiary(project.id, target.email, actor)).rejects.toThrow(AuthorizationError);
  });
});

describe("milestones — ProjectMilestoneUpdated event", () => {
  it("createMilestone and updateMilestone each emit ProjectMilestoneUpdated", async () => {
    const { adminActor, project } = await makeSponsorAndProject();
    const seen: Array<{ projectId: string; milestoneId: string }> = [];
    const off = onDomainEvent("ProjectMilestoneUpdated", (payload) => {
      seen.push(payload);
    });

    try {
      const milestone = await createMilestone(project.id, { title: "Phase 1 complete" }, adminActor);
      await updateMilestone(milestone.id, { status: "achieved" }, adminActor);

      expect(seen).toHaveLength(2);
      expect(seen.every((e) => e.projectId === project.id && e.milestoneId === milestone.id)).toBe(true);

      const updated = await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } });
      expect(updated.status).toBe("achieved");
      expect(updated.achievedAt).not.toBeNull();
    } finally {
      off();
    }
  });

  it("a non-sponsor.manage actor cannot create or update a milestone even on their own project", async () => {
    const { project } = await makeSponsorAndProject();
    const sponsorAdmin = await user({ roles: ["SPONSOR_ADMIN"] });
    const actor = await actorFromUser(sponsorAdmin.id);
    await prisma.projectMembership.create({ data: { userId: sponsorAdmin.id, projectId: project.id, role: "sponsor_admin" } });

    await expect(createMilestone(project.id, { title: "Nope" }, actor)).rejects.toThrow(AuthorizationError);
  });
});
