"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  approveJoinRequest,
  changeMemberRole,
  inviteToOrganization,
  rejectJoinRequest,
  reinstateMembership,
  removeMembership,
  revokeOrganizationInvitation,
  setOrganizationStatus,
  suspendMembership,
  updateOrganizationSettings,
  type OrgRole,
} from "@/lib/organizations";
import { AuthorizationError } from "@/lib/authz";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function orgPath(organizationId: string) {
  return `/organizations/${organizationId}`;
}

async function runAction(organizationId: string, fn: () => Promise<void>) {
  let error: string | null = null;
  try {
    await fn();
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
  }
  revalidatePath(orgPath(organizationId));
  if (error) redirect(`${orgPath(organizationId)}?error=${error}`);
}

export async function updateSettingsAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  await runAction(organizationId, () =>
    updateOrganizationSettings(
      organizationId,
      {
        name: String(formData.get("name") ?? "") || undefined,
        type: (String(formData.get("type") ?? "") || undefined) as never,
        description: String(formData.get("description") ?? ""),
        contactEmail: String(formData.get("contactEmail") ?? ""),
        contactPhone: String(formData.get("contactPhone") ?? ""),
      },
      actor
    )
  );
}

export async function setStatusAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const status = String(formData.get("status")) as "pending" | "active" | "suspended" | "archived";
  await runAction(organizationId, () => setOrganizationStatus(organizationId, status, actor));
}

export async function inviteMemberAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const email = String(formData.get("email") ?? "").trim();
  const role = (String(formData.get("role") ?? "org_member") as OrgRole) ?? "org_member";
  await runAction(organizationId, async () => {
    if (!email) throw new Error("Email is required");
    await inviteToOrganization(organizationId, email, role, actor);
  });
}

export async function approveJoinRequestAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const membershipId = String(formData.get("membershipId"));
  await runAction(organizationId, () => approveJoinRequest(membershipId, actor));
}

export async function rejectJoinRequestAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const membershipId = String(formData.get("membershipId"));
  await runAction(organizationId, () => rejectJoinRequest(membershipId, actor));
}

export async function suspendMembershipAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const membershipId = String(formData.get("membershipId"));
  await runAction(organizationId, () => suspendMembership(membershipId, actor));
}

export async function reinstateMembershipAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const membershipId = String(formData.get("membershipId"));
  await runAction(organizationId, () => reinstateMembership(membershipId, actor));
}

export async function removeMembershipAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const membershipId = String(formData.get("membershipId"));
  await runAction(organizationId, () => removeMembership(membershipId, actor));
}

export async function changeMemberRoleAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const membershipId = String(formData.get("membershipId"));
  const role = String(formData.get("role")) as OrgRole;
  await runAction(organizationId, () => changeMemberRole(membershipId, role, actor));
}

export async function revokeInvitationAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId"));
  const invitationId = String(formData.get("invitationId"));
  await runAction(organizationId, () => revokeOrganizationInvitation(invitationId, actor));
}
