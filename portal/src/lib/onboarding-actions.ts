"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { sendMail } from "@/lib/mailer";
import {
  acceptOrganizationMembershipInvite,
  approveJoinRequest,
  changeMemberRole,
  createOrganization,
  getOrganizationById,
  inviteToOrganization,
  rejectJoinRequest,
  reinstateMembership,
  removeMembership,
  requestToJoinOrganization,
  revokeOrganizationInvitation,
  suspendMembership,
  updateOrganizationSettings,
  type OrgRole,
} from "@/lib/organizations";

/**
 * Session 18 (B2B & B2C Onboarding) — Server Actions shared by BOTH the
 * teacher and student portals' /onboarding and /organization surfaces
 * (src/app/teacher/(protected)/{onboarding,organization}/**,
 * src/app/student/(protected)/{onboarding,organization}/**). A person's
 * ORGANIZATION-scoped role (org_admin/org_member, from Session 17's
 * OrganizationMembership) is entirely independent of their PLATFORM role
 * (TEACHER/STUDENT) — the same underlying organizations.ts functions and
 * authorization apply no matter which portal the request came from, so one
 * shared action module avoids maintaining two copies of identical
 * mutation/redirect logic (see each portal's page.tsx for the thin,
 * portal-specific rendering that calls into these).
 *
 * Every action takes a hidden `redirectTo` form field set by the calling
 * page — same mutation always used from more than one context (e.g.
 * /onboarding wants to move the user forward to /dashboard on success;
 * /organization wants to stay put and just show the updated list), so the
 * page decides where "success" and "?error=..." land, not this module.
 */

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "keenafrica.com";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

/** Defends against anything other than our own hidden same-origin field ever reaching redirect(). */
function target(formData: FormData, fallback: string): string {
  const raw = formData.get("redirectTo");
  return typeof raw === "string" && raw.startsWith("/") ? raw : fallback;
}

async function run(formData: FormData, fallback: string, fn: () => Promise<unknown>): Promise<never> {
  const redirectTo = target(formData, fallback);
  let error: string | null = null;
  try {
    await fn();
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
  }
  revalidatePath(redirectTo.split("?")[0]);
  redirect(error ? `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}error=${error}` : redirectTo);
}

// --- Onboarding decision: create / join / skip ------------------------------

export async function createOrganizationSelfAction(formData: FormData) {
  const actor = await requireActor();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const type = String(formData.get("type") ?? "other");
  const description = String(formData.get("description") ?? "");

  await run(formData, "/organization", async () => {
    if (!name || !slug) throw new Error("Name and slug are required");
    await createOrganization({ name, slug, type: type as never, description }, actor);
  });
}

export async function requestToJoinSelfAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, "/organization", () => requestToJoinOrganization(organizationId, actor));
}

/** Accept a direct 'invited' membership row (an org_admin invited an already-existing account). */
export async function acceptMembershipInviteSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  await run(formData, "/organization", () => acceptOrganizationMembershipInvite(membershipId, actor));
}

/** Self-service decline-an-invite OR leave-an-org — both are just "remove my own membership row." */
export async function leaveOrDeclineMembershipSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  await run(formData, "/organization", () => removeMembership(membershipId, actor));
}

// --- Org-admin roster management (org-scoped, not organizations.manage) ----

export async function updateOrganizationSettingsSelfAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () =>
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

function portalSubdomain(platformRole: string): "teacher" | "student" {
  return platformRole === "TEACHER" ? "teacher" : "student";
}

/**
 * Invites by email and attempts delivery via src/lib/mailer.ts's sendMail()
 * stub. No real transactional email provider exists yet (Session 19's
 * job — see docs/IDENTITY_SECURITY.md "Blockers", the same gap
 * password-reset already documented) — sendMail() throws in production,
 * dev-console-logs otherwise. Either way, the invite link is ALSO stashed
 * in a short-lived cookie so the org_admin who triggered this can see and
 * relay it out of band, mirroring src/app/admin/(protected)/users/[id]/
 * actions.ts's triggerPasswordResetAction exactly. `platformRole` is UI-only
 * (never persisted — OrganizationInvitation has no platform-role column):
 * it just picks which portal's /register (or /login, for an existing
 * account) the link points at.
 */
export async function inviteMemberSelfAction(formData: FormData) {
  const actor = await requireActor();
  const organizationId = String(formData.get("organizationId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = (String(formData.get("role") ?? "org_member") as OrgRole) ?? "org_member";
  const sub = portalSubdomain(String(formData.get("platformRole") ?? "STUDENT"));
  const redirectTo = target(formData, `/organization/${organizationId}`);

  let error: string | null = null;
  let cookieKey: string | null = null;
  let link: string | null = null;
  try {
    if (!email) throw new Error("Email is required");
    const org = await getOrganizationById(organizationId, actor);
    const orgName = org?.name ?? "your organization";
    const roleLabel = role === "org_admin" ? "an admin" : "a member";
    const result = await inviteToOrganization(organizationId, email, role, actor);

    if (result.mode === "email_invitation") {
      link = `https://${sub}.${ROOT_DOMAIN}/register?invite=${result.token}`;
      cookieKey = `org_invite_link_${result.invitationId}`;
      try {
        await sendMail({
          to: email,
          subject: `You're invited to join ${orgName} on Keen Africa`,
          text: `You've been invited to join ${orgName} as ${roleLabel}.\n\nCreate your account to accept:\n${link}\n\nThis link expires in 14 days. If you weren't expecting this, you can ignore it.`,
        });
      } catch {
        // Expected in production until Session 19 wires a real provider —
        // the link is still relayed via the cookie below.
      }
    } else {
      link = `https://${sub}.${ROOT_DOMAIN}/login`;
      cookieKey = `org_invite_link_${result.membershipId}`;
      try {
        await sendMail({
          to: email,
          subject: `You're invited to join ${orgName} on Keen Africa`,
          text: `You've been invited to join ${orgName} as ${roleLabel}.\n\nLog in and open "Organization" to accept:\n${link}`,
        });
      } catch {
        // Same as above.
      }
    }
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
  }

  if (link && cookieKey) {
    const store = await cookies();
    store.set(cookieKey, link, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60,
      path: "/organization",
    });
  }

  revalidatePath(redirectTo.split("?")[0]);
  const qs = new URLSearchParams();
  if (error) qs.set("error", error);
  else if (cookieKey) qs.set("inviteLinkKey", cookieKey);
  const suffix = qs.toString();
  redirect(suffix ? `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}${suffix}` : redirectTo);
}

export async function approveJoinRequestSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () => approveJoinRequest(membershipId, actor));
}

export async function rejectJoinRequestSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () => rejectJoinRequest(membershipId, actor));
}

export async function suspendMembershipSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () => suspendMembership(membershipId, actor));
}

export async function reinstateMembershipSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () => reinstateMembership(membershipId, actor));
}

export async function removeMembershipSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () => removeMembership(membershipId, actor));
}

export async function changeMemberRoleSelfAction(formData: FormData) {
  const actor = await requireActor();
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  const role = String(formData.get("role")) as OrgRole;
  await run(formData, `/organization/${organizationId}`, () => changeMemberRole(membershipId, role, actor));
}

export async function revokeInvitationSelfAction(formData: FormData) {
  const actor = await requireActor();
  const invitationId = String(formData.get("invitationId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  await run(formData, `/organization/${organizationId}`, () => revokeOrganizationInvitation(invitationId, actor));
}
