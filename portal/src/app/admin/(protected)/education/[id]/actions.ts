"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, PERMISSIONS, requirePermission } from "@/lib/authz";
import { withRls } from "@/lib/rls";
import {
  archiveCourse,
  assignTeacherToCohort,
  createCohort,
  enrollStudent,
  publishCourse,
  removeTeacherFromCohort,
  updateCourseDetails,
  withdrawEnrollment,
} from "@/lib/courses";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

/**
 * Resolves an email typed into an admin form to a user id. Requires
 * courses.manage (checked by the caller already having reached this point
 * via a form only rendered for that permission) plus users.read — every
 * role that holds courses.manage by default (ADMIN/SUPER_ADMIN) also holds
 * users.read, so this stays within the actor's real RLS-visible rows.
 */
async function resolveUserIdByEmail(email: string, actor: Awaited<ReturnType<typeof requireActor>>) {
  requirePermission(actor, PERMISSIONS.USERS_READ);
  const found = await withRls(
    { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] },
    (tx) => tx.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } })
  );
  return found?.id ?? null;
}

export async function updateCourseAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await updateCourseDetails(courseId, { title, description }, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function publishCourseAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");

  let error: string | null = null;
  try {
    await publishCourse(courseId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function archiveCourseAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");

  let error: string | null = null;
  try {
    await archiveCourse(courseId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function createCohortAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  let error: string | null = null;
  if (!name) {
    error = "missing_fields";
  } else {
    try {
      await createCohort(courseId, { name }, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function assignTeacherAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const cohortId = String(formData.get("cohortId") ?? "");
  const email = String(formData.get("teacherEmail") ?? "").trim();

  let error: string | null = null;
  try {
    const teacherId = await resolveUserIdByEmail(email, actor);
    if (!teacherId) {
      error = "user_not_found";
    } else {
      await assignTeacherToCohort(cohortId, teacherId, actor);
    }
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function removeTeacherAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const cohortId = String(formData.get("cohortId") ?? "");
  const teacherUserId = String(formData.get("teacherUserId") ?? "");

  let error: string | null = null;
  try {
    await removeTeacherFromCohort(cohortId, teacherUserId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function enrollStudentAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const cohortId = String(formData.get("cohortId") ?? "");
  const email = String(formData.get("studentEmail") ?? "").trim();

  let error: string | null = null;
  try {
    const studentId = await resolveUserIdByEmail(email, actor);
    if (!studentId) {
      error = "user_not_found";
    } else {
      await enrollStudent(cohortId, studentId, actor);
    }
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}

export async function withdrawEnrollmentAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const enrollmentId = String(formData.get("enrollmentId") ?? "");

  let error: string | null = null;
  try {
    await withdrawEnrollment(enrollmentId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/education/${courseId}`);
  if (error) redirect(`/education/${courseId}?error=${error}`);
}
