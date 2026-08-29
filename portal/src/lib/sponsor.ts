import { withRls } from "@/lib/rls";
import {
  AuthorizationError,
  PERMISSIONS,
  hasPermission,
  requirePermission,
  type AuthzActor,
  type PermissionKey,
} from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { uploadAsset, deleteAssetIfOrphanedAsContentOwner } from "@/lib/assets";

/**
 * Sponsor Core (Session 11) — extends the Phase-1 Sponsor/Project/
 * ProjectMembership scaffold (schema.prisma already had these three
 * models before this session). Authorization is rebuilt on Session 02's
 * Role/Permission model, mirroring src/lib/courses.ts's shape exactly:
 *
 *   - PERMISSIONS.SPONSOR_MANAGE: admin/staff full management (sponsors,
 *     projects, milestones, metrics, documents, any project's membership).
 *     ADMIN/SUPER_ADMIN hold it via ALL_PERMISSION_KEYS.
 *   - PERMISSIONS.SPONSOR_PROJECTS_READ: necessary but not sufficient —
 *     the actor must ALSO hold a ProjectMembership row (role='sponsor_admin',
 *     the "sponsor-side project team" relationship — see that model's own
 *     doc comment in schema.prisma) for the specific project. This is the
 *     ownership/relationship check the session brief asks to rebuild off
 *     the old MembershipRole-only ad hoc checks — isProjectSponsorMember/
 *     requireProjectSponsorAccess below are the direct analogue of
 *     courses.ts's isCourseTeacher/requireCourseContentAccess.
 *   - PERMISSIONS.SPONSOR_USERS_MANAGE: lets a project's own sponsor-team
 *     member invite/remove ANOTHER sponsor-team member (never a
 *     beneficiary row) on that same project.
 *
 * Beneficiary privacy (explicit "Must NOT" in the session brief: "expose
 * sensitive student information merely because a student is a
 * beneficiary"): a ProjectMembership row alone carries no PII (just
 * user_id/project_id/role), so RLS granting a sponsor visibility into
 * project_memberships rows is safe on its own. The risk is joining from
 * there into `users` — that table's own RLS (users_select) only grants a
 * non-super-admin/non-users.read caller their OWN row, which a sponsor
 * correctly does NOT hold for a beneficiary. listProjectBeneficiaries/
 * getProjectBeneficiaryCount below therefore run their `users` read under
 * an internal SYSTEM_CTX (bypasses RLS, same "already-authorized caller"
 * pattern as sessions.ts's revokeAllUserSessionsAsSystem/notifications.ts's
 * SYSTEM_CTX) — but ONLY after this module's own requireProjectSponsorAccess
 * check has run, and the projection returned is deliberately minimal
 * (id + a first-name/last-initial display name): never email, phone,
 * enrollment/assessment/academic data, notes, or messages. RLS is a
 * row-level backstop, not column-level (see docs/IDENTITY_SECURITY.md's
 * "Known limitations"), so this narrow, explicit projection is the actual
 * privacy control here — widening users_select instead would hand a
 * sponsor the beneficiary's full row (including password_hash).
 *
 * See docs/SPONSOR_CORE.md for the full contract.
 */

const SYSTEM_CTX = { isSuperAdmin: true } as const;

export function actorRlsCtx(actor: AuthzActor) {
  return { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] };
}

/** True when actor holds a project_memberships row (role='sponsor_admin') for this project — the "sponsor-side project team" relationship. */
export async function isProjectSponsorMember(projectId: string, actor: AuthzActor): Promise<boolean> {
  const count = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.count({ where: { userId: actor.id, projectId, role: "sponsor_admin" } })
  );
  return count > 0;
}

/**
 * The shared ownership gate for every sponsor-portal read/write on a
 * specific project. super_admin and sponsor.manage holders bypass
 * ownership entirely; a sponsor.projects.read/sponsor.users.manage holder
 * must additionally be on that project's sponsor team. Throws
 * AuthorizationError on failure.
 */
export async function requireProjectSponsorAccess(
  projectId: string,
  actor: AuthzActor,
  key: PermissionKey = PERMISSIONS.SPONSOR_PROJECTS_READ
): Promise<void> {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.SPONSOR_MANAGE)) return;
  requirePermission(actor, key);
  if (!(await isProjectSponsorMember(projectId, actor))) {
    throw new AuthorizationError("Not a member of this project's sponsor team");
  }
}

function requireSponsorManage(actor: AuthzActor): void {
  if (actor.isSuperAdmin) return;
  requirePermission(actor, PERMISSIONS.SPONSOR_MANAGE);
}

// --- Sponsor ----------------------------------------------------------------

export async function createSponsor(name: string, actor: AuthzActor) {
  requireSponsorManage(actor);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Sponsor name is required");

  const sponsor = await withRls(actorRlsCtx(actor), (tx) => tx.sponsor.create({ data: { name: trimmed } }));
  await recordAuditEvent({ actorId: actor.id, action: "sponsor.created", entityType: "Sponsor", entityId: sponsor.id });
  return sponsor;
}

export async function updateSponsor(sponsorId: string, name: string, actor: AuthzActor) {
  requireSponsorManage(actor);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Sponsor name is required");

  await withRls(actorRlsCtx(actor), (tx) => tx.sponsor.update({ where: { id: sponsorId }, data: { name: trimmed } }));
  await recordAuditEvent({ actorId: actor.id, action: "sponsor.updated", entityType: "Sponsor", entityId: sponsorId });
}

// --- Project ------------------------------------------------------------

const RESERVED_SLUGS = new Set(["admin", "teacher", "student", "sponsor", "www", "api", "app", "auth", "static", "assets"]);
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

export interface CreateProjectInput {
  sponsorId: string;
  name: string;
  slug: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
}

export async function createProject(input: CreateProjectInput, actor: AuthzActor) {
  requireSponsorManage(actor);
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name) throw new Error("Project name is required");
  if (!input.sponsorId) throw new Error("Sponsor is required");
  if (!SLUG_RE.test(slug)) throw new Error("Slug must be 3-40 lowercase letters, numbers, or hyphens");
  if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a reserved slug, choose another`);

  const project = await withRls(actorRlsCtx(actor), (tx) =>
    tx.project.create({
      data: {
        sponsorId: input.sponsorId,
        name,
        slug,
        description: input.description?.trim() || null,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "project.created", entityType: "Project", entityId: project.id });
  return project;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: "draft" | "active" | "paused";
  startDate?: Date | null;
  endDate?: Date | null;
}

export async function updateProject(projectId: string, input: UpdateProjectInput, actor: AuthzActor) {
  requireSponsorManage(actor);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "project.updated", entityType: "Project", entityId: projectId });
}

/** Sponsor-portal read: every project (any status) the actor's own sponsor team is on. super_admin/sponsor.manage see everything active+draft+paused. */
export async function listMyProjects(actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.project.findMany({
      where: actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.SPONSOR_MANAGE)
        ? {}
        : { memberships: { some: { userId: actor.id, role: "sponsor_admin" } } },
      include: { sponsor: true },
      orderBy: { createdAt: "desc" },
    })
  );
}

export async function getProjectForSponsor(projectId: string, actor: AuthzActor) {
  await requireProjectSponsorAccess(projectId, actor);
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.project.findUnique({ where: { id: projectId }, include: { sponsor: true } })
  );
}

export interface DashboardProjectSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  sponsorName: string;
  milestonesTotal: number;
  milestonesAchieved: number;
  beneficiaryCount: number;
  documentCount: number;
}

/** The sponsor dashboard's per-project summary row — one round trip of aggregate counts per project (small N in practice: a sponsor org's own project count). */
export async function getDashboardSummary(actor: AuthzActor): Promise<DashboardProjectSummary[]> {
  const projects = await listMyProjects(actor);

  return Promise.all(
    projects.map(async (project) => {
      const [milestonesTotal, milestonesAchieved, beneficiaryCount, documentCount] = await withRls(
        actorRlsCtx(actor),
        (tx) =>
          Promise.all([
            tx.milestone.count({ where: { projectId: project.id } }),
            tx.milestone.count({ where: { projectId: project.id, status: "achieved" } }),
            tx.projectMembership.count({ where: { projectId: project.id, role: "beneficiary" } }),
            tx.projectDocument.count({ where: { projectId: project.id } }),
          ])
      );

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        sponsorName: project.sponsor.name,
        milestonesTotal,
        milestonesAchieved,
        beneficiaryCount,
        documentCount,
      };
    })
  );
}

// --- Milestones -----------------------------------------------------------

export interface CreateMilestoneInput {
  title: string;
  description?: string;
  targetDate?: Date;
}

export async function createMilestone(projectId: string, input: CreateMilestoneInput, actor: AuthzActor) {
  requireSponsorManage(actor);
  const title = input.title.trim();
  if (!title) throw new Error("Milestone title is required");

  const milestone = await withRls(actorRlsCtx(actor), (tx) =>
    tx.milestone.create({
      data: { projectId, title, description: input.description?.trim() || null, targetDate: input.targetDate, createdBy: actor.id },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "milestone.created", entityType: "Milestone", entityId: milestone.id, metadata: { projectId } });
  emitDomainEvent("ProjectMilestoneUpdated", { projectId, milestoneId: milestone.id });
  return milestone;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string;
  targetDate?: Date | null;
  status?: "planned" | "in_progress" | "achieved" | "missed";
}

export async function updateMilestone(milestoneId: string, input: UpdateMilestoneInput, actor: AuthzActor) {
  requireSponsorManage(actor);

  const milestone = await withRls(actorRlsCtx(actor), (tx) =>
    tx.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
        ...(input.status !== undefined ? { status: input.status, achievedAt: input.status === "achieved" ? new Date() : null } : {}),
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "milestone.updated", entityType: "Milestone", entityId: milestoneId, metadata: { projectId: milestone.projectId, status: milestone.status } });
  emitDomainEvent("ProjectMilestoneUpdated", { projectId: milestone.projectId, milestoneId });
  return milestone;
}

export async function listMilestonesForProject(projectId: string, actor: AuthzActor) {
  await requireProjectSponsorAccess(projectId, actor);
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.milestone.findMany({ where: { projectId }, orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }] })
  );
}

// --- Project metrics (impact data / reporting hooks) -----------------------

export interface RecordMetricInput {
  label: string;
  value: number;
  unit?: string;
  recordedAt?: Date;
}

export async function recordProjectMetric(projectId: string, input: RecordMetricInput, actor: AuthzActor) {
  requireSponsorManage(actor);
  const label = input.label.trim();
  if (!label) throw new Error("Metric label is required");
  if (!Number.isFinite(input.value)) throw new Error("Metric value must be a number");

  const metric = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMetric.create({
      data: { projectId, label, value: input.value, unit: input.unit?.trim() || null, recordedAt: input.recordedAt ?? new Date(), createdBy: actor.id },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "project_metric.recorded", entityType: "ProjectMetric", entityId: metric.id, metadata: { projectId, label, value: input.value } });
  return metric;
}

export async function listProjectMetrics(projectId: string, actor: AuthzActor) {
  await requireProjectSponsorAccess(projectId, actor);
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMetric.findMany({ where: { projectId }, orderBy: { recordedAt: "desc" } })
  );
}

export interface ImpactSummaryEntry {
  label: string;
  latestValue: number;
  unit: string | null;
  recordedAt: Date;
  sampleCount: number;
}

/**
 * The Session 12 (Reporting & Impact) reporting hook: the most recent
 * sample per label, plus how many samples exist (so a future report can
 * distinguish "one-off figure" from "tracked over time"). Deliberately a
 * plain read function, not a materialized view — Session 12 owns actual
 * report generation/export; this just guarantees the underlying data
 * contract exists and is ownership-scoped identically to every other read
 * here.
 */
export async function getProjectImpactSummary(projectId: string, actor: AuthzActor): Promise<ImpactSummaryEntry[]> {
  const metrics = await listProjectMetrics(projectId, actor);
  const byLabel = new Map<string, ImpactSummaryEntry>();
  for (const m of metrics) {
    const existing = byLabel.get(m.label);
    if (existing) {
      existing.sampleCount += 1;
      continue;
    }
    byLabel.set(m.label, { label: m.label, latestValue: m.value, unit: m.unit, recordedAt: m.recordedAt, sampleCount: 1 });
  }
  return Array.from(byLabel.values());
}

// --- Sponsor team / project membership --------------------------------------

export interface SponsorTeamMemberResult {
  membershipId: string;
  userId: string;
  needsRoleGrant: boolean;
}

/**
 * Adds an EXISTING platform user (looked up by exact email) to a project's
 * sponsor team (role='sponsor_admin' ProjectMembership). Never creates a
 * new User row — reuses the canonical identity (CLAUDE_BUILD_RULES.md §3);
 * an operator without an account yet needs an admin to create one first
 * (src/lib/users.ts's createUser(), same as every other portal).
 *
 * Two authorized paths, matching requireProjectSponsorAccess's shape:
 *   - sponsor.manage (admin/staff): also grants the SPONSOR_USER platform
 *     role if the target holds neither SPONSOR_ADMIN nor SPONSOR_USER yet,
 *     via users.ts's assignRole() — safe here because sponsor.manage
 *     holders (ADMIN/SUPER_ADMIN) already hold roles.manage too.
 *   - sponsor.users.manage + ownership (a sponsor-team member acting on
 *     their own project): does NOT touch roles.manage-gated role
 *     assignment (that permission is Admin-only, per least privilege) —
 *     the membership row is created, but `needsRoleGrant` comes back true
 *     if the target still needs an admin to grant them a sponsor Role
 *     before they can reach the sponsor portal at all.
 */
export async function addProjectTeamMember(projectId: string, email: string, actor: AuthzActor): Promise<SponsorTeamMemberResult> {
  await requireProjectSponsorAccess(projectId, actor, PERMISSIONS.SPONSOR_USERS_MANAGE);

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");

  const target = await withRls(SYSTEM_CTX, (tx) => tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }));
  if (!target) throw new Error("No platform account exists for that email yet — an admin must create it first");

  const existingRoles = await withRls(SYSTEM_CTX, (tx) =>
    tx.userRole.findMany({ where: { userId: target.id }, include: { role: { select: { name: true } } } })
  );
  const hasSponsorRole = existingRoles.some((ur) => ur.role.name === "SPONSOR_ADMIN" || ur.role.name === "SPONSOR_USER");

  const canGrantRole = actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.SPONSOR_MANAGE);
  if (!hasSponsorRole && canGrantRole) {
    const { assignRole } = await import("@/lib/users");
    await assignRole(target.id, "SPONSOR_USER", actor);
  }

  const membership = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.upsert({
      where: { userId_projectId: { userId: target.id, projectId } },
      update: { role: "sponsor_admin" },
      create: { userId: target.id, projectId, role: "sponsor_admin" },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "project_membership.added",
    entityType: "ProjectMembership",
    entityId: membership.id,
    metadata: { projectId, targetUserId: target.id, role: "sponsor_admin" },
  });

  return { membershipId: membership.id, userId: target.id, needsRoleGrant: !hasSponsorRole && !canGrantRole };
}

export async function removeProjectTeamMember(projectId: string, userId: string, actor: AuthzActor): Promise<void> {
  await requireProjectSponsorAccess(projectId, actor, PERMISSIONS.SPONSOR_USERS_MANAGE);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.deleteMany({ where: { projectId, userId, role: "sponsor_admin" } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "project_membership.removed",
    entityType: "ProjectMembership",
    entityId: `${projectId}:${userId}`,
    metadata: { projectId, targetUserId: userId, role: "sponsor_admin" },
  });
}

export interface SponsorTeamMember {
  userId: string;
  name: string;
  email: string;
}

/** The project's own sponsor-team roster — the acting sponsor's colleagues, not beneficiaries. Safe to show full name/email: these are the sponsor org's own staff, not students. */
export async function listProjectTeam(projectId: string, actor: AuthzActor): Promise<SponsorTeamMember[]> {
  await requireProjectSponsorAccess(projectId, actor);

  const memberships = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.findMany({ where: { projectId, role: "sponsor_admin" }, select: { userId: true } })
  );
  if (memberships.length === 0) return [];

  const users = await withRls(SYSTEM_CTX, (tx) =>
    tx.user.findMany({ where: { id: { in: memberships.map((m) => m.userId) } }, select: { id: true, name: true, email: true } })
  );
  return users.map((u) => ({ userId: u.id, name: u.name, email: u.email }));
}

// --- Beneficiaries (privacy-aware — see this file's header) ----------------

function anonymizedDisplayName(fullName: string): string {
  // Strip a trailing parenthetical annotation (e.g. "QA Student
  // (non-production test account)") before splitting into name parts —
  // otherwise the last "word" is the annotation's own last token, not the
  // person's actual last name (found live in Session 28's QA pass: "QA
  // Student (non-production test account)" anonymized to "QA a." instead
  // of "QA S.", because parts[parts.length - 1] was "account)").
  const nameOnly = fullName.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = nameOnly.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Beneficiary";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export interface BeneficiarySummary {
  id: string;
  displayName: string;
}

/**
 * NEVER returns email/phone/academic data — see this file's header for why.
 * Requires the caller to have already passed requireProjectSponsorAccess
 * (enforced here, not assumed) before the SYSTEM_CTX users read runs.
 */
export async function listProjectBeneficiaries(projectId: string, actor: AuthzActor): Promise<BeneficiarySummary[]> {
  await requireProjectSponsorAccess(projectId, actor);

  const memberships = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.findMany({ where: { projectId, role: "beneficiary" }, select: { userId: true } })
  );
  if (memberships.length === 0) return [];

  const users = await withRls(SYSTEM_CTX, (tx) =>
    tx.user.findMany({ where: { id: { in: memberships.map((m) => m.userId) } }, select: { id: true, name: true } })
  );
  return users.map((u) => ({ id: u.id, displayName: anonymizedDisplayName(u.name) }));
}

export async function getProjectBeneficiaryCount(projectId: string, actor: AuthzActor): Promise<number> {
  await requireProjectSponsorAccess(projectId, actor);
  return withRls(actorRlsCtx(actor), (tx) => tx.projectMembership.count({ where: { projectId, role: "beneficiary" } }));
}

/** Admin-only: links an existing user (by email) to a project as a beneficiary. Registration/placement of beneficiaries is an admin/education-side action, not sponsor self-service — see docs/SPONSOR_CORE.md. */
export async function addProjectBeneficiary(projectId: string, email: string, actor: AuthzActor): Promise<void> {
  requireSponsorManage(actor);

  const normalizedEmail = email.trim().toLowerCase();
  const target = await withRls(SYSTEM_CTX, (tx) => tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }));
  if (!target) throw new Error("No platform account exists for that email yet");

  const membership = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.upsert({
      where: { userId_projectId: { userId: target.id, projectId } },
      update: { role: "beneficiary" },
      create: { userId: target.id, projectId, role: "beneficiary" },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "project_membership.added",
    entityType: "ProjectMembership",
    entityId: membership.id,
    metadata: { projectId, targetUserId: target.id, role: "beneficiary" },
  });
}

// --- Sponsor-visible documents -----------------------------------------------

export interface UploadProjectDocumentInput {
  title: string;
  originalFilename: string;
  declaredMimeType: string;
  buffer: Buffer;
}

/** Admin/staff-authored (sponsor.manage) — see this file's header for why documents are read-only for the sponsor-portal side in this session. */
export async function uploadProjectDocument(projectId: string, input: UploadProjectDocumentInput, actor: AuthzActor) {
  requireSponsorManage(actor);

  const asset = await uploadAsset({ originalFilename: input.originalFilename, declaredMimeType: input.declaredMimeType, buffer: input.buffer }, actor);

  try {
    const document = await withRls(actorRlsCtx(actor), async (tx) => {
      const created = await tx.projectDocument.create({
        data: { projectId, title: input.title.trim() || input.originalFilename, assetId: asset.id, uploadedBy: actor.id },
      });
      await tx.assetAttachment.create({
        data: { assetId: asset.id, entityType: "sponsor_document", entityId: created.id, attachedBy: actor.id },
      });
      return created;
    });

    await recordAuditEvent({ actorId: actor.id, action: "project_document.uploaded", entityType: "ProjectDocument", entityId: document.id, metadata: { projectId, assetId: asset.id } });
    return document;
  } catch (err) {
    await deleteAssetIfOrphanedAsContentOwner(asset.id, actor).catch(() => {});
    throw err;
  }
}

export async function listProjectDocuments(projectId: string, actor: AuthzActor) {
  await requireProjectSponsorAccess(projectId, actor);
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.projectDocument.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, include: { asset: { select: { originalFilename: true, mimeType: true, sizeBytes: true } } } })
  );
}

export async function removeProjectDocument(documentId: string, actor: AuthzActor): Promise<void> {
  requireSponsorManage(actor);

  const doc = await withRls(actorRlsCtx(actor), (tx) => tx.projectDocument.findUnique({ where: { id: documentId }, select: { projectId: true, assetId: true } }));
  if (!doc) throw new Error("Document not found");

  await withRls(actorRlsCtx(actor), async (tx) => {
    await tx.assetAttachment.deleteMany({ where: { entityType: "sponsor_document", entityId: documentId } });
    await tx.projectDocument.delete({ where: { id: documentId } });
  });

  await deleteAssetIfOrphanedAsContentOwner(doc.assetId, actor).catch(() => {});
  await recordAuditEvent({ actorId: actor.id, action: "project_document.removed", entityType: "ProjectDocument", entityId: documentId, metadata: { projectId: doc.projectId } });
}
