import crypto from "node:crypto";
import { withRls } from "@/lib/rls";
import {
  AuthorizationError,
  PERMISSIONS,
  hasPermission,
  type AuthzActor,
} from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";

/**
 * Organization Core (Session 17) — a general-purpose membership/tenant
 * boundary (school, church, company, NGO, training center, or an
 * individual's personal B2C space), deliberately separate from Sponsor
 * Core (a funding/project relationship — never merged/renamed/made a
 * parent of this). See docs/ORGANIZATION_CORE.md for the full contract.
 *
 * Two authorization layers, mirroring courses.ts/sponsor.ts's shape:
 *   - PERMISSIONS.ORGANIZATIONS_MANAGE: a Platform Admin's cross-tenant
 *     reach — every organization, unconditionally. ADMIN/SUPER_ADMIN hold
 *     it via ALL_PERMISSION_KEYS.
 *   - Org-scoped role (OrganizationMembership.role): 'org_admin' manages
 *     exactly ONE organization (its own) — invite/approve/reject/suspend/
 *     reinstate/remove members, change member roles, update org settings.
 *     'org_member' is a plain member: visible in their own org's roster,
 *     no management rights. This is answering a DIFFERENT question than
 *     the global Role/Permission model (PLATFORM_CONTEXT.md's "what can
 *     this person do on Keen Africa" vs. "what can this person do inside
 *     THIS organization") — never collapsed into one enum.
 *
 * requireOrgPermission() below is the shared gate every mutating/
 * management function in this module goes through — the org-scoped analog
 * of authz.ts's requirePermission().
 *
 * Membership is always gated (CLAUDE_BUILD_RULES.md §5, this session's own
 * explicit Rule): requestToJoinOrganization() only ever creates a
 * 'pending' row for the caller themselves — never 'active' — and
 * inviteToOrganization()/acceptOrganizationInvitation() are the only paths
 * that can move a row to 'active' for someone who isn't already an
 * org_admin/organizations.manage holder acting on their own org. Nobody
 * can grant themselves active membership merely by supplying an
 * organization id or name.
 */

export type OrgRole = "org_admin" | "org_member";
export type OrgMembershipStatus = "invited" | "pending" | "active" | "suspended" | "removed";

/** The actor shape this module needs — organizationIds is optional so any bare AuthzActor (e.g. test fixtures) still type-checks; every real request actor (session.user) carries it (see next-auth.d.ts). */
export type OrgActor = AuthzActor & { organizationIds?: readonly string[] };

const SYSTEM_CTX = { isSuperAdmin: true } as const;

function actorRlsCtx(actor: OrgActor) {
  return {
    userId: actor.id,
    isSuperAdmin: actor.isSuperAdmin,
    permissions: [...actor.permissions],
    organizationIds: actor.organizationIds ? [...actor.organizationIds] : [],
  };
}

function hasGlobalOrgManage(actor: OrgActor): boolean {
  return actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.ORGANIZATIONS_MANAGE);
}

async function getOwnMembership(organizationId: string, actor: OrgActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: actor.id } },
      select: { role: true, status: true },
    })
  );
}

/**
 * The org-scoped analog of authz.ts's requirePermission(). super_admin and
 * organizations.manage holders bypass the org-scoped check entirely (a
 * Platform Admin's reach into any single organization, matching this
 * session's explicit acceptance criterion). Otherwise the actor must hold
 * an ACTIVE OrganizationMembership in THIS organization, at least at
 * `minRole`. Throws AuthorizationError on failure.
 */
export async function requireOrgPermission(
  organizationId: string,
  actor: OrgActor,
  minRole: OrgRole = "org_member"
): Promise<void> {
  if (hasGlobalOrgManage(actor)) return;

  const membership = await getOwnMembership(organizationId, actor);
  if (!membership || membership.status !== "active") {
    throw new AuthorizationError("Not a member of this organization");
  }
  if (minRole === "org_admin" && membership.role !== "org_admin") {
    throw new AuthorizationError("Not an admin of this organization");
  }
}

/** True/false version of requireOrgPermission, for UI-gating reads that shouldn't throw. */
export async function hasOrgPermission(organizationId: string, actor: OrgActor, minRole: OrgRole = "org_member"): Promise<boolean> {
  try {
    await requireOrgPermission(organizationId, actor, minRole);
    return true;
  } catch {
    return false;
  }
}

async function countActiveOrgAdmins(organizationId: string): Promise<number> {
  return withRls(SYSTEM_CTX, (tx) =>
    tx.organizationMembership.count({ where: { organizationId, role: "org_admin", status: "active" } })
  );
}

// --- Organization ---------------------------------------------------------

const RESERVED_SLUGS = new Set(["admin", "teacher", "student", "sponsor", "www", "api", "app", "auth", "static", "assets"]);
const SLUG_RE = /^[a-z0-9-]{3,60}$/;

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  type?: "school" | "church" | "company" | "ngo" | "training_center" | "government" | "university" | "community" | "personal" | "other";
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/**
 * Any authenticated actor may found a new organization — no
 * organizations.manage gate (Session 18's self-service "create a new
 * organization" path depends on this). The creator becomes that
 * organization's first org_admin member, active immediately, in the same
 * transaction — see the organization_core migration's dedicated WRITE
 * policy branch for why that specific insert is authorized.
 */
export async function createOrganization(input: CreateOrganizationInput, actor: OrgActor) {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name) throw new Error("Organization name is required");
  if (!SLUG_RE.test(slug)) throw new Error("Slug must be 3-60 lowercase letters, numbers, or hyphens");
  if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a reserved slug, choose another`);

  const org = await withRls(actorRlsCtx(actor), async (tx) => {
    const created = await tx.organization.create({
      data: {
        name,
        slug,
        type: input.type ?? "other",
        description: input.description?.trim() || null,
        contactEmail: input.contactEmail?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        createdBy: actor.id,
      },
    });
    await tx.organizationMembership.create({
      data: { organizationId: created.id, userId: actor.id, role: "org_admin", status: "active", joinedAt: new Date() },
    });
    return created;
  });

  await recordAuditEvent({ actorId: actor.id, action: "organization.created", entityType: "Organization", entityId: org.id, metadata: { slug } });
  emitDomainEvent("OrganizationCreated", { organizationId: org.id, actorId: actor.id });
  return org;
}

export interface UpdateOrganizationSettingsInput {
  name?: string;
  type?: CreateOrganizationInput["type"];
  description?: string;
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/** Org-scoped profile settings — org_admin of THIS org, or organizations.manage/super_admin. Never touches `status`/`verifiedAt` — see setOrganizationStatus. */
export async function updateOrganizationSettings(organizationId: string, input: UpdateOrganizationSettingsInput, actor: OrgActor) {
  await requireOrgPermission(organizationId, actor, "org_admin");

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl.trim() || null } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail.trim() || null } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone.trim() || null } : {}),
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "organization.updated", entityType: "Organization", entityId: organizationId });
}

/** Platform-level lifecycle (verification/suspension/archival) — organizations.manage/super_admin ONLY, deliberately not delegable to an org_admin. */
export async function setOrganizationStatus(
  organizationId: string,
  status: "pending" | "active" | "suspended" | "archived",
  actor: OrgActor
) {
  if (!hasGlobalOrgManage(actor)) {
    throw new AuthorizationError("Missing permission: organizations.manage");
  }

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.organization.update({
      where: { id: organizationId },
      data: { status, ...(status === "active" ? { verifiedAt: new Date() } : {}) },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "organization.status_changed", entityType: "Organization", entityId: organizationId, metadata: { status } });
}

export async function getOrganizationById(organizationId: string, actor: OrgActor) {
  return withRls(actorRlsCtx(actor), (tx) => tx.organization.findUnique({ where: { id: organizationId } }));
}

export interface ListOrganizationsFilter {
  status?: "pending" | "active" | "suspended" | "archived";
  search?: string;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/** Admin console's organization directory — requires organizations.manage (a Platform Admin's cross-tenant view), same "no ownership bypass on an enumeration read" reasoning as users.ts's listUsers. */
export async function listOrganizations(filter: ListOrganizationsFilter, actor: OrgActor) {
  if (!hasGlobalOrgManage(actor)) {
    throw new AuthorizationError("Missing permission: organizations.manage");
  }

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = filter.search?.trim();

  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [organizations, total] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.organization.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.organization.count({ where }),
    ])
  );

  return { organizations, total, page, pageSize };
}

/** Self-scoped: every organization the caller holds ANY membership row in (invited/pending/active/suspended), for a future "my organizations" surface (Session 18). No permission required — always self. */
export async function listMyOrganizations(actor: OrgActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationMembership.findMany({
      where: { userId: actor.id, status: { not: "removed" } },
      include: { organization: true },
      orderBy: { createdAt: "desc" },
    })
  );
}

// --- Membership roster / lifecycle -----------------------------------------

export interface OrganizationMemberSummary {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  status: OrgMembershipStatus;
  invitedBy: string | null;
  joinedAt: Date | null;
  createdAt: Date;
}

/** Full roster (every status) for managing the invite/approve/suspend/remove lifecycle — org_admin of THIS org, or organizations.manage/super_admin. */
export async function listOrganizationMembers(organizationId: string, actor: OrgActor): Promise<OrganizationMemberSummary[]> {
  await requireOrgPermission(organizationId, actor, "org_admin");

  const memberships = await withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationMembership.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    })
  );
  if (memberships.length === 0) return [];

  // Same SYSTEM_CTX-after-authorization pattern as sponsor.ts's
  // listProjectTeam: requireOrgPermission has already run above, and
  // membership rows carry no PII themselves — this just resolves
  // name/email for display, never bypassing an authorization check.
  const users = await withRls(SYSTEM_CTX, (tx) =>
    tx.user.findMany({ where: { id: { in: memberships.map((m) => m.userId) } }, select: { id: true, name: true, email: true } })
  );
  const userById = new Map(users.map((u) => [u.id, u]));

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: userById.get(m.userId)?.name ?? "(unknown)",
    email: userById.get(m.userId)?.email ?? "",
    role: m.role,
    status: m.status,
    invitedBy: m.invitedBy,
    joinedAt: m.joinedAt,
    createdAt: m.createdAt,
  }));
}

/**
 * Self-service "request to join" — never grants access on its own (starts
 * at 'pending', requires approveJoinRequest below). Idempotent against a
 * prior 'removed' row (reactivates it to 'pending'); throws if a
 * non-removed row already exists (already invited/pending/active/
 * suspended — nothing to request).
 */
export async function requestToJoinOrganization(organizationId: string, actor: OrgActor) {
  const membership = await withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: actor.id } },
      create: { organizationId, userId: actor.id, role: "org_member", status: "pending" },
      update: { status: "pending" },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "organization_membership.requested",
    entityType: "OrganizationMembership",
    entityId: membership.id,
    metadata: { organizationId },
  });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId, membershipId: membership.id, userId: actor.id, actorId: actor.id });
  return membership;
}

async function requireMembershipInOrg(membershipId: string, actor: OrgActor) {
  const membership = await withRls(actorRlsCtx(actor), (tx) => tx.organizationMembership.findUnique({ where: { id: membershipId } }));
  if (!membership) throw new Error("Membership not found");
  return membership;
}

/** org_admin/manage approves a 'pending' join request. */
export async function approveJoinRequest(membershipId: string, actor: OrgActor) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  await requireOrgPermission(membership.organizationId, actor, "org_admin");
  if (membership.status !== "pending") throw new Error("Membership is not a pending join request");

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationMembership.update({ where: { id: membershipId }, data: { status: "active", joinedAt: new Date() } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.approved", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

/** org_admin/manage rejects a 'pending' join request — kept as history (status='removed'), never deleted. */
export async function rejectJoinRequest(membershipId: string, actor: OrgActor, reason?: string) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  await requireOrgPermission(membership.organizationId, actor, "org_admin");
  if (membership.status !== "pending") throw new Error("Membership is not a pending join request");

  await withRls(actorRlsCtx(actor), (tx) => tx.organizationMembership.update({ where: { id: membershipId }, data: { status: "removed" } }));

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.rejected", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId, reason } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

/** The invited user (self) accepts an 'invited'-status row created by an org_admin. org_admin/manage may also accept on the invitee's behalf. */
export async function acceptOrganizationMembershipInvite(membershipId: string, actor: OrgActor) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  if (membership.userId !== actor.id) {
    await requireOrgPermission(membership.organizationId, actor, "org_admin");
  }
  if (membership.status !== "invited") throw new Error("Membership is not a pending invitation");

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationMembership.update({ where: { id: membershipId }, data: { status: "active", joinedAt: new Date() } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.accepted", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

/** org_admin/manage suspends an active member. Refuses to suspend the org's last active org_admin (would orphan the organization). */
export async function suspendMembership(membershipId: string, actor: OrgActor, reason?: string) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  await requireOrgPermission(membership.organizationId, actor, "org_admin");
  if (membership.status !== "active") throw new Error("Membership is not active");
  if (membership.role === "org_admin" && (await countActiveOrgAdmins(membership.organizationId)) <= 1) {
    throw new Error("Cannot suspend the organization's last active admin");
  }

  await withRls(actorRlsCtx(actor), (tx) => tx.organizationMembership.update({ where: { id: membershipId }, data: { status: "suspended" } }));

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.suspended", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId, reason } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

export async function reinstateMembership(membershipId: string, actor: OrgActor) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  await requireOrgPermission(membership.organizationId, actor, "org_admin");
  if (membership.status !== "suspended") throw new Error("Membership is not suspended");

  await withRls(actorRlsCtx(actor), (tx) => tx.organizationMembership.update({ where: { id: membershipId }, data: { status: "active" } }));

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.reinstated", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

/** org_admin/manage removes a member, OR a member removes themselves ("leave organization"). Refuses to remove the org's last active org_admin. */
export async function removeMembership(membershipId: string, actor: OrgActor) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  const isSelf = membership.userId === actor.id;
  if (!isSelf) {
    await requireOrgPermission(membership.organizationId, actor, "org_admin");
  }
  if (membership.status === "removed") return; // idempotent
  if (membership.role === "org_admin" && membership.status === "active" && (await countActiveOrgAdmins(membership.organizationId)) <= 1) {
    throw new Error("Cannot remove the organization's last active admin");
  }

  await withRls(actorRlsCtx(actor), (tx) => tx.organizationMembership.update({ where: { id: membershipId }, data: { status: "removed" } }));

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.removed", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId, self: isSelf } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

/** org_admin/manage changes a member's org-scoped role. Refuses to demote the org's last active org_admin. */
export async function changeMemberRole(membershipId: string, newRole: OrgRole, actor: OrgActor) {
  const membership = await requireMembershipInOrg(membershipId, actor);
  await requireOrgPermission(membership.organizationId, actor, "org_admin");
  if (membership.status !== "active") throw new Error("Membership is not active");
  if (membership.role === newRole) return;
  if (membership.role === "org_admin" && newRole === "org_member" && (await countActiveOrgAdmins(membership.organizationId)) <= 1) {
    throw new Error("Cannot demote the organization's last active admin");
  }

  await withRls(actorRlsCtx(actor), (tx) => tx.organizationMembership.update({ where: { id: membershipId }, data: { role: newRole } }));

  await recordAuditEvent({ actorId: actor.id, action: "organization_membership.role_changed", entityType: "OrganizationMembership", entityId: membershipId, metadata: { organizationId: membership.organizationId, targetUserId: membership.userId, role: newRole } });
  emitDomainEvent("OrganizationMembershipChanged", { organizationId: membership.organizationId, membershipId, userId: membership.userId, actorId: actor.id });
}

// --- Invitation (email-based, works before the invitee has an account) ----

const ORG_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export type InviteToOrganizationResult =
  | { mode: "existing_user"; membershipId: string; userId: string }
  | { mode: "email_invitation"; invitationId: string; token: string };

/**
 * org_admin/manage invites by email. If the address already has a platform
 * account, this creates an OrganizationMembership row directly at
 * status='invited' (the invitee still has to accept —
 * acceptOrganizationMembershipInvite — before it counts as active
 * membership). Otherwise it creates an OrganizationInvitation with a raw,
 * single-use token (returned ONLY here, like requestPasswordReset) —
 * Session 18 links this to registration completion.
 */
export async function inviteToOrganization(
  organizationId: string,
  email: string,
  role: OrgRole,
  actor: OrgActor
): Promise<InviteToOrganizationResult> {
  await requireOrgPermission(organizationId, actor, "org_admin");

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");

  const existingUser = await withRls(SYSTEM_CTX, (tx) => tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }));

  if (existingUser) {
    const existingMembership = await withRls(actorRlsCtx(actor), (tx) =>
      tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: existingUser.id } } })
    );
    if (existingMembership && (existingMembership.status === "active" || existingMembership.status === "suspended")) {
      throw new Error("This person is already a member of the organization");
    }

    const membership = await withRls(actorRlsCtx(actor), (tx) =>
      tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId, userId: existingUser.id } },
        create: { organizationId, userId: existingUser.id, role, status: "invited", invitedBy: actor.id },
        update: { role, status: "invited", invitedBy: actor.id },
      })
    );

    await recordAuditEvent({ actorId: actor.id, action: "organization_membership.invited", entityType: "OrganizationMembership", entityId: membership.id, metadata: { organizationId, targetUserId: existingUser.id, role } });
    return { mode: "existing_user", membershipId: membership.id, userId: existingUser.id };
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ORG_INVITATION_TTL_MS);

  const invitation = await withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationInvitation.create({ data: { organizationId, email: normalizedEmail, role, tokenHash, expiresAt, invitedBy: actor.id } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "organization_invitation.created", entityType: "OrganizationInvitation", entityId: invitation.id, metadata: { organizationId, email: normalizedEmail, role } });
  return { mode: "email_invitation", invitationId: invitation.id, token: rawToken };
}

/** org_admin/manage revokes a still-pending email invitation. */
export async function revokeOrganizationInvitation(invitationId: string, actor: OrgActor) {
  const invitation = await withRls(actorRlsCtx(actor), (tx) => tx.organizationInvitation.findUnique({ where: { id: invitationId } }));
  if (!invitation) throw new Error("Invitation not found");
  await requireOrgPermission(invitation.organizationId, actor, "org_admin");
  if (invitation.status !== "pending") return; // idempotent

  await withRls(actorRlsCtx(actor), (tx) => tx.organizationInvitation.update({ where: { id: invitationId }, data: { status: "revoked" } }));
  await recordAuditEvent({ actorId: actor.id, action: "organization_invitation.revoked", entityType: "OrganizationInvitation", entityId: invitationId, metadata: { organizationId: invitation.organizationId } });
}

export async function listOrganizationInvitations(organizationId: string, actor: OrgActor) {
  await requireOrgPermission(organizationId, actor, "org_admin");
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.organizationInvitation.findMany({ where: { organizationId, status: "pending" }, orderBy: { createdAt: "desc" } })
  );
}

export type AcceptOrganizationInvitationOutcome = "ok" | "invalid_or_expired";

/**
 * Token-based acceptance — the authenticated actor (existing user, or a
 * brand-new one Session 18 just registered) redeems the raw token from
 * inviteToOrganization()'s email_invitation branch. Uses
 * app.org_invitation_lookup for both the pre-authorized lookup and the
 * resulting membership INSERT — see the organization_core migration's RLS
 * policy comments for exactly why that's needed (the accepting user isn't
 * already an org_admin/organizations.manage holder for this org; the
 * invitation itself, already created by one, is the authorization).
 */
export async function acceptOrganizationInvitation(rawToken: string, actor: AuthzActor): Promise<AcceptOrganizationInvitationOutcome> {
  const tokenHash = hashToken(rawToken);

  const invitation = await withRls({ orgInvitationLookup: true }, (tx) => tx.organizationInvitation.findUnique({ where: { tokenHash } }));

  if (!invitation || invitation.status !== "pending" || invitation.expiresAt.getTime() <= Date.now()) {
    return "invalid_or_expired";
  }

  await withRls({ userId: actor.id, orgInvitationLookup: true }, async (tx) => {
    await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId: actor.id } },
      create: {
        organizationId: invitation.organizationId,
        userId: actor.id,
        role: invitation.role,
        status: "active",
        invitedBy: invitation.invitedBy,
        joinedAt: new Date(),
      },
      update: { role: invitation.role, status: "active", invitedBy: invitation.invitedBy, joinedAt: new Date() },
    });
    await tx.organizationInvitation.update({ where: { id: invitation.id }, data: { status: "accepted", acceptedAt: new Date() } });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "organization_membership.accepted",
    entityType: "OrganizationMembership",
    entityId: invitation.id,
    metadata: { organizationId: invitation.organizationId, viaInvitation: true },
  });
  emitDomainEvent("OrganizationMembershipChanged", {
    organizationId: invitation.organizationId,
    membershipId: invitation.id,
    userId: actor.id,
    actorId: actor.id,
  });

  return "ok";
}
