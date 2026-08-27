"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { AuthzActor } from "@/lib/authz";
import {
  addProjectBeneficiary,
  addProjectTeamMember,
  createMilestone,
  createProject,
  createSponsor,
  recordProjectMetric,
  removeProjectDocument,
  removeProjectTeamMember,
  updateMilestone,
  updateProject,
  uploadProjectDocument,
} from "@/lib/sponsor";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : "action_failed";
}

// --- Dashboard-level (sponsor/project creation) ----------------------------

export async function createSponsorAction(formData: FormData) {
  const actor = await requireActor();
  await createSponsor(String(formData.get("name") ?? ""), actor);
  revalidatePath("/dashboard");
}

export async function createProjectAction(formData: FormData) {
  const actor = await requireActor();
  await createProject(
    {
      sponsorId: String(formData.get("sponsorId") ?? ""),
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
    },
    actor
  );
  revalidatePath("/dashboard");
}

// --- Project detail management ----------------------------------------------

function finish(projectId: string, error: string | null) {
  revalidatePath(`/sponsors/${projectId}`);
  if (error) redirect(`/sponsors/${projectId}?error=${encodeURIComponent(error)}`);
  redirect(`/sponsors/${projectId}?success=1`);
}

export async function updateProjectAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "");

  let error: string | null = null;
  try {
    await updateProject(
      projectId,
      {
        name: String(formData.get("name") ?? "") || undefined,
        description: String(formData.get("description") ?? ""),
        status: status === "active" || status === "draft" || status === "paused" ? status : undefined,
      },
      actor
    );
  } catch (err) {
    error = toError(err);
  }
  finish(projectId, error);
}

export async function createMilestoneAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const targetDateRaw = String(formData.get("targetDate") ?? "");

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await createMilestone(
        projectId,
        {
          title,
          description: String(formData.get("description") ?? ""),
          targetDate: targetDateRaw ? new Date(targetDateRaw) : undefined,
        },
        actor
      );
    } catch (err) {
      error = toError(err);
    }
  }
  finish(projectId, error);
}

export async function updateMilestoneStatusAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const milestoneId = String(formData.get("milestoneId") ?? "");
  const status = String(formData.get("status") ?? "");

  let error: string | null = null;
  try {
    await updateMilestone(milestoneId, { status: status as "planned" | "in_progress" | "achieved" | "missed" }, actor);
  } catch (err) {
    error = toError(err);
  }
  finish(projectId, error);
}

export async function recordMetricAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const value = Number.parseFloat(String(formData.get("value") ?? ""));

  let error: string | null = null;
  if (!label || !Number.isFinite(value)) {
    error = "missing_fields";
  } else {
    try {
      await recordProjectMetric(projectId, { label, value, unit: String(formData.get("unit") ?? "") }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  finish(projectId, error);
}

export async function addTeamMemberAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const email = String(formData.get("email") ?? "");

  let error: string | null = null;
  try {
    await addProjectTeamMember(projectId, email, actor);
  } catch (err) {
    error = toError(err);
  }
  finish(projectId, error);
}

export async function removeTeamMemberAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  let error: string | null = null;
  try {
    await removeProjectTeamMember(projectId, userId, actor);
  } catch (err) {
    error = toError(err);
  }
  finish(projectId, error);
}

export async function addBeneficiaryAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const email = String(formData.get("email") ?? "");

  let error: string | null = null;
  try {
    await addProjectBeneficiary(projectId, email, actor);
  } catch (err) {
    error = toError(err);
  }
  finish(projectId, error);
}

export async function uploadDocumentAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const file = formData.get("file");

  let error: string | null = null;
  if (!title || !(file instanceof File) || file.size === 0) {
    error = "missing_fields";
  } else {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadProjectDocument(
        projectId,
        { title, originalFilename: file.name, declaredMimeType: file.type || "application/octet-stream", buffer },
        actor
      );
    } catch (err) {
      error = toError(err);
    }
  }
  finish(projectId, error);
}

export async function removeDocumentAction(formData: FormData) {
  const actor = await requireActor();
  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");

  let error: string | null = null;
  try {
    await removeProjectDocument(documentId, actor);
  } catch (err) {
    error = toError(err);
  }
  finish(projectId, error);
}
