"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import {
  ArticleNotFoundError,
  EmailNotVerifiedError,
  RateLimitedError,
  archiveArticle,
  createArticle,
  publishArticle,
  removeCoverImage,
  setCoverImage,
  unpublishArticle,
  updateArticle,
} from "@/lib/articles";
import { FileTooLargeError, UnsupportedFileTypeError } from "@/lib/assets";
import { requestEmailVerification } from "@/lib/email-verification";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  if (err instanceof AuthorizationError) return "not_authorized";
  if (err instanceof RateLimitedError) return "rate_limited";
  if (err instanceof EmailNotVerifiedError) return "email_not_verified";
  if (err instanceof ArticleNotFoundError) return "not_found";
  if (err instanceof UnsupportedFileTypeError) return "unsupported_file_type";
  if (err instanceof FileTooLargeError) return "file_too_large";
  return "action_failed";
}

export async function createArticleAction(formData: FormData) {
  const actor = await requireActor();
  const title = String(formData.get("title") ?? "").trim();

  let error: string | null = null;
  let articleId: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      const article = await createArticle({ title, body: "" }, actor);
      articleId = article.id;
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath("/dashboard");
  if (error) redirect(`/articles/new?error=${error}`);
  redirect(`/articles/${articleId}/edit`);
}

async function finish(articleId: string, error: string | null) {
  revalidatePath("/dashboard");
  revalidatePath(`/articles/${articleId}/edit`);
  if (error) redirect(`/articles/${articleId}/edit?error=${error}`);
  redirect(`/articles/${articleId}/edit?saved=1`);
}

export async function updateArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const excerpt = String(formData.get("excerpt") ?? "");
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await updateArticle(articleId, { title, body, excerpt, tags }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(articleId, error);
}

export async function publishArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await publishArticle(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(articleId, error);
}

export async function unpublishArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await unpublishArticle(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(articleId, error);
}

export async function archiveArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await archiveArticle(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath("/dashboard");
  if (error) redirect(`/articles/${articleId}/edit?error=${error}`);
  redirect("/dashboard");
}

export async function setCoverImageAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const file = formData.get("file");

  let error: string | null = null;
  if (!(file instanceof File) || file.size === 0) {
    error = "missing_fields";
  } else {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await setCoverImage(
        articleId,
        { originalFilename: file.name, declaredMimeType: file.type || "application/octet-stream", buffer },
        actor
      );
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(articleId, error);
}

export async function removeCoverImageAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await removeCoverImage(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(articleId, error);
}

export async function resendVerificationAction() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await requestEmailVerification(session.user.id, session.user.email!, session.user.name ?? session.user.email!);
  revalidatePath("/dashboard");
  redirect("/dashboard?verification=sent");
}
