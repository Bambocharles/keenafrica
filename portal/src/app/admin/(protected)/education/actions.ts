"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { createCourse } from "@/lib/courses";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

export async function createCourseAction(formData: FormData) {
  const actor = await requireActor();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  let error: string | null = null;
  let courseId: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      const course = await createCourse({ title, description }, actor);
      courseId = course.id;
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath("/education");
  if (error) redirect(`/education?error=${error}`);
  if (courseId) redirect(`/education/${courseId}`);
}
