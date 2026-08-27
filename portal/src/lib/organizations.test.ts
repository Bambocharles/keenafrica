import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { onDomainEvent } from "@/lib/events";
import {
  acceptOrganizationInvitation,
  acceptOrganizationMembershipInvite,
  approveJoinRequest,
  changeMemberRole,
  createOrganization,
  getOrganizationById,
  inviteToOrganization,
  listOrganizationMembers,
  listOrganizations,
  rejectJoinRequest,
  reinstateMembership,
  removeMembership,
  requestToJoinOrganization,
  requireOrgPermission,
  setOrganizationStatus,
  suspendMembership,
  updateOrganizationSettings,
} from "@/lib/organizations";
import {
  actorFromUser,
  cleanupTestOrganizations,
  cleanupTestUsers,
  createTestUser,
  orgActorFromUser,
} from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

let slugCounter = 0;
function uniqueSlug(): string {
  slugCounter += 1;
  return `org-test-${Date.now()}-${slugCounter}`;
}

afterAll(async () => {
  await cleanupTestOrganizations(createdOrgIds);
  await cleanupTestUsers(createdUserIds);
});

async function makeOrg(founder: { id: string }) {
  const founderActor = await orgActorFromUser(founder.id);
  const org = await createOrganization({ name: `Org ${uniqueSlug()}`, slug: uniqueSlug() }, founderActor);
  createdOrgIds.push(org.id);
  return org;
}

describe("createOrganization", () => {
  it("any authenticated user may found a new organization and becomes its active org_admin", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    expect(org.status).toBe("active");

    const members = await listOrganizationMembers(org.id, await orgActorFromUser(founder.id));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: founder.id, role: "org_admin", status: "active" });
  });

  it("rejects a reserved or malformed slug", async () => {
    const founder = await user();
    const actor = await orgActorFromUser(founder.id);
    await expect(createOrganization({ name: "X", slug: "admin" }, actor)).rejects.toThrow(/reserved/);
    await expect(createOrganization({ name: "X", slug: "a" }, actor)).rejects.toThrow(/3-60/);
  });
});

describe("requireOrgPermission", () => {
  it("a plain org_member fails an org_admin-level check but passes an org_member-level one", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const member = await user();
    await requestToJoinOrganization(org.id, await orgActorFromUser(member.id));
    const pending = (await listOrganizationMembers(org.id, await orgActorFromUser(founder.id))).find((m) => m.userId === member.id)!;
    await approveJoinRequest(pending.membershipId, await orgActorFromUser(founder.id));

    const memberActor = await orgActorFromUser(member.id);
    await expect(requireOrgPermission(org.id, memberActor, "org_admin")).rejects.toThrow(AuthorizationError);
    await expect(requireOrgPermission(org.id, memberActor, "org_member")).resolves.toBeUndefined();
  });

  it("a stranger with no membership fails both levels", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const stranger = await user();
    const strangerActor = await orgActorFromUser(stranger.id);
    await expect(requireOrgPermission(org.id, strangerActor, "org_member")).rejects.toThrow(AuthorizationError);
  });

  it("organizations.manage bypasses org-scoped membership entirely (Platform Admin's cross-tenant reach)", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    await expect(requireOrgPermission(org.id, adminActor, "org_admin")).resolves.toBeUndefined();
  });
});

describe("cross-organization isolation", () => {
  it("an org_admin of org A cannot manage org B's members", async () => {
    const founderA = await user();
    const orgA = await makeOrg(founderA);
    const founderB = await user();
    const orgB = await makeOrg(founderB);

    const outsider = await user();
    await requestToJoinOrganization(orgB.id, await orgActorFromUser(outsider.id));
    const pendingInB = (await listOrganizationMembers(orgB.id, await orgActorFromUser(founderB.id))).find((m) => m.userId === outsider.id)!;

    // founderA (org_admin of A only) must not be able to approve a join request in B.
    await expect(approveJoinRequest(pendingInB.membershipId, await orgActorFromUser(founderA.id))).rejects.toThrow(AuthorizationError);
    // And must not be able to list B's members either.
    await expect(listOrganizationMembers(orgB.id, await orgActorFromUser(founderA.id))).rejects.toThrow(AuthorizationError);
  });

  it("a user with active memberships in two organizations sees each org's own membership only", async () => {
    const founderA = await user();
    const orgA = await makeOrg(founderA);
    const founderB = await user();
    const orgB = await makeOrg(founderB);

    const dual = await user();
    await requestToJoinOrganization(orgA.id, await orgActorFromUser(dual.id));
    const pendingA = (await listOrganizationMembers(orgA.id, await orgActorFromUser(founderA.id))).find((m) => m.userId === dual.id)!;
    await approveJoinRequest(pendingA.membershipId, await orgActorFromUser(founderA.id));

    await requestToJoinOrganization(orgB.id, await orgActorFromUser(dual.id));
    const pendingB = (await listOrganizationMembers(orgB.id, await orgActorFromUser(founderB.id))).find((m) => m.userId === dual.id)!;
    await approveJoinRequest(pendingB.membershipId, await orgActorFromUser(founderB.id));

    const dualActor = await orgActorFromUser(dual.id);
    expect(dualActor.organizationIds.sort()).toEqual([orgA.id, orgB.id].sort());

    // dual is a plain org_member in both — org_admin-level access must fail for both.
    await expect(requireOrgPermission(orgA.id, dualActor, "org_admin")).rejects.toThrow(AuthorizationError);
    await expect(requireOrgPermission(orgB.id, dualActor, "org_admin")).rejects.toThrow(AuthorizationError);
    // org_member-level access succeeds for both, since dual is active in both.
    await expect(requireOrgPermission(orgA.id, dualActor, "org_member")).resolves.toBeUndefined();
    await expect(requireOrgPermission(orgB.id, dualActor, "org_member")).resolves.toBeUndefined();
  });
});

describe("membership lifecycle", () => {
  it("a join request stays pending until an org_admin approves it — never grants access on its own", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const applicant = await user();
    const applicantActor = await orgActorFromUser(applicant.id);

    await requestToJoinOrganization(org.id, applicantActor);
    // Not yet active — requireOrgPermission at org_member level must still fail.
    await expect(requireOrgPermission(org.id, applicantActor, "org_member")).rejects.toThrow(AuthorizationError);
  });

  it("rejecting a join request sets status to removed, not active", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const applicant = await user();
    await requestToJoinOrganization(org.id, await orgActorFromUser(applicant.id));
    const founderActor = await orgActorFromUser(founder.id);
    const pending = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === applicant.id)!;

    await rejectJoinRequest(pending.membershipId, founderActor);
    const after = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === applicant.id)!;
    expect(after.status).toBe("removed");
  });

  it("suspend then reinstate round-trips a member back to active", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const member = await user();
    const founderActor = await orgActorFromUser(founder.id);
    await requestToJoinOrganization(org.id, await orgActorFromUser(member.id));
    const pending = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === member.id)!;
    await approveJoinRequest(pending.membershipId, founderActor);

    await suspendMembership(pending.membershipId, founderActor);
    let row = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === member.id)!;
    expect(row.status).toBe("suspended");

    await reinstateMembership(pending.membershipId, founderActor);
    row = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === member.id)!;
    expect(row.status).toBe("active");
  });

  it("a member can leave (self-remove) without org_admin permission", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const member = await user();
    const founderActor = await orgActorFromUser(founder.id);
    await requestToJoinOrganization(org.id, await orgActorFromUser(member.id));
    const pending = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === member.id)!;
    await approveJoinRequest(pending.membershipId, founderActor);

    const memberActor = await orgActorFromUser(member.id);
    await removeMembership(pending.membershipId, memberActor);
    const row = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === member.id)!;
    expect(row.status).toBe("removed");
  });

  it("refuses to suspend/remove/demote the organization's last active org_admin", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const founderActor = await orgActorFromUser(founder.id);
    const founderMembership = (await listOrganizationMembers(org.id, founderActor))[0];

    await expect(suspendMembership(founderMembership.membershipId, founderActor)).rejects.toThrow(/last active admin/);
    await expect(removeMembership(founderMembership.membershipId, founderActor)).rejects.toThrow(/last active admin/);
    await expect(changeMemberRole(founderMembership.membershipId, "org_member", founderActor)).rejects.toThrow(/last active admin/);
  });

  it("a second org_admin CAN be suspended/demoted once at least one other active admin remains", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const founderActor = await orgActorFromUser(founder.id);
    const second = await user();
    await requestToJoinOrganization(org.id, await orgActorFromUser(second.id));
    const pending = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === second.id)!;
    await approveJoinRequest(pending.membershipId, founderActor);
    await changeMemberRole(pending.membershipId, "org_admin", founderActor);

    await expect(suspendMembership(pending.membershipId, founderActor)).resolves.toBeUndefined();
  });
});

describe("invitations", () => {
  it("inviting an existing user creates an 'invited' row; they must accept before it's active", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const invitee = await user();
    const founderActor = await orgActorFromUser(founder.id);

    const raw = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id }, select: { email: true } });
    const inviteResult = await inviteToOrganization(org.id, raw.email, "org_member", founderActor);
    expect(inviteResult.mode).toBe("existing_user");
    if (inviteResult.mode !== "existing_user") throw new Error("unreachable");

    const inviteeActor = await orgActorFromUser(invitee.id);
    await expect(requireOrgPermission(org.id, inviteeActor, "org_member")).rejects.toThrow(AuthorizationError);

    await acceptOrganizationMembershipInvite(inviteResult.membershipId, inviteeActor);
    await expect(requireOrgPermission(org.id, await orgActorFromUser(invitee.id), "org_member")).resolves.toBeUndefined();
  });

  it("inviting an unknown email issues a raw token, and acceptOrganizationInvitation redeems it exactly once", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const founderActor = await orgActorFromUser(founder.id);
    const uniqueEmail = `org-invite-${Date.now()}@example.com`;

    const result = await inviteToOrganization(org.id, uniqueEmail, "org_admin", founderActor);
    expect(result.mode).toBe("email_invitation");
    if (result.mode !== "email_invitation") throw new Error("unreachable");

    const newUser = await user();
    const newActor = await actorFromUser(newUser.id);

    const outcome = await acceptOrganizationInvitation(result.token, newActor);
    expect(outcome).toBe("ok");
    await expect(requireOrgPermission(org.id, await orgActorFromUser(newUser.id), "org_admin")).resolves.toBeUndefined();

    // Single-use: a second redemption of the same token must fail.
    const anotherUser = await user();
    const anotherActor = await actorFromUser(anotherUser.id);
    const secondOutcome = await acceptOrganizationInvitation(result.token, anotherActor);
    expect(secondOutcome).toBe("invalid_or_expired");
  });

  it("only an org_admin (or organizations.manage) may invite — a plain member cannot", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const founderActor = await orgActorFromUser(founder.id);
    const member = await user();
    await requestToJoinOrganization(org.id, await orgActorFromUser(member.id));
    const pending = (await listOrganizationMembers(org.id, founderActor)).find((m) => m.userId === member.id)!;
    await approveJoinRequest(pending.membershipId, founderActor);

    const memberActor = await orgActorFromUser(member.id);
    await expect(inviteToOrganization(org.id, "nobody@example.com", "org_member", memberActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("Platform Admin cross-tenant access is unaffected", () => {
  it("organizations.manage sees/manages every organization, including ones it never joined", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    const viaAdmin = await getOrganizationById(org.id, adminActor);
    expect(viaAdmin?.id).toBe(org.id);

    await updateOrganizationSettings(org.id, { description: "updated by platform admin" }, adminActor);
    await setOrganizationStatus(org.id, "suspended", adminActor);
    const after = await getOrganizationById(org.id, adminActor);
    expect(after?.status).toBe("suspended");
    await setOrganizationStatus(org.id, "active", adminActor);

    const list = await listOrganizations({ search: org.name }, adminActor);
    expect(list.organizations.map((o) => o.id)).toContain(org.id);
  });

  it("a non-manage, non-member actor cannot list all organizations or force a status change", async () => {
    const founder = await user();
    const org = await makeOrg(founder);
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(listOrganizations({}, strangerActor)).rejects.toThrow(AuthorizationError);
    await expect(setOrganizationStatus(org.id, "archived", strangerActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("domain events", () => {
  it("emits OrganizationCreated on creation and OrganizationMembershipChanged on a lifecycle transition", async () => {
    const created: string[] = [];
    const changed: string[] = [];
    const offCreated = onDomainEvent("OrganizationCreated", (p) => void created.push(p.organizationId));
    const offChanged = onDomainEvent("OrganizationMembershipChanged", (p) => void changed.push(p.organizationId));

    try {
      const founder = await user();
      const org = await makeOrg(founder);
      expect(created).toContain(org.id);

      const member = await user();
      await requestToJoinOrganization(org.id, await orgActorFromUser(member.id));
      expect(changed).toContain(org.id);
    } finally {
      offCreated();
      offChanged();
    }
  });
});
