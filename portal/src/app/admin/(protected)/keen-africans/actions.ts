"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { adminUnpublishArticle } from "@/lib/articles";

export async function adminUnpublishArticleAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const articleId = String(formData.get("articleId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  let error: string | null = null;
  if (!reason) {
    error = "reason_required";
  } else {
    try {
      await adminUnpublishArticle(articleId, actor, reason);
    } catch (err) {
      error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
    }
  }

  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}
