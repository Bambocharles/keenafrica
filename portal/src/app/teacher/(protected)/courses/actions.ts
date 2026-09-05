"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { createCourse } from "@/lib/courses";

/**
 * Session 45 (Outstanding Fixes & Consolidation) — the teacher-side entry
 * point for organization-scoped course creation, implementing the decision
 * recorded in status/project-status.md on 2026-08-31.
 *
 * Deliberately a thin wrapper: every authorization decision lives in
 * src/lib/courses.ts's createCourse()/assertMayCreateCourse() and, again
 * and independently, in courses_write's RLS policy. This file resolves the
 * actor, forwards the form fields, and maps errors to a query string —
 * exactly the shape of admin/(protected)/education/actions.ts, which this
 * mirrors rather than inventing a second pattern.
 *
 * organizationId comes from the form, i.e. from the client, and is
 * therefore untrusted: the page only renders organizations the caller is an
 * active member of, but that is UI convenience, never the boundary. A
 * crafted POST naming any other organization is refused server-side by
 * createCourse(), and by Postgres underneath it. That negative path is
 * covered by tests in organization-aware-education.test.ts (application
 * layer) and organization-aware-education-rls.integration.test.ts (RLS).
 */
export async function createOrganizationCourseAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const organizationId = String(formData.get("organizationId") ?? "").trim();

  let error: string | null = null;
  if (!title || !organizationId) {
    error = "missing_fields";
  } else {
    try {
      await createCourse({ title, description, organizationId }, actor);
    } catch (err) {
      error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
    }
  }

  revalidatePath("/courses");
  redirect(error ? `/courses?error=${error}` : "/courses?created=1");
}
