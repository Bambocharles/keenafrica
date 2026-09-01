"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ArticleTopic } from "@prisma/client";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import {
  ARTICLE_TOPICS,
  ArticleNotFoundError,
  EmailNotVerifiedError,
  InvalidReviewTransitionError,
  InvalidScheduleError,
  InvalidSlugError,
  RateLimitedError,
  ReviewNotApprovedError,
  archiveArticle,
  cancelScheduledPublish,
  createArticle,
  publishArticle,
  removeCoverImage,
  renderArticleBodyHtml,
  scheduleArticle,
  setCoverImage,
  submitForReview,
  unpublishArticle,
  updateArticle,
  updateArticleSlug,
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
  if (err instanceof ReviewNotApprovedError) return "review_not_approved";
  if (err instanceof InvalidReviewTransitionError) return "invalid_review_transition";
  if (err instanceof InvalidSlugError) return err.message === "That URL is already taken by another article" ? "slug_taken" : "invalid_slug";
  if (err instanceof InvalidScheduleError) return "invalid_schedule";
  return "action_failed";
}

function parseTopic(formData: FormData): ArticleTopic | null {
  const raw = String(formData.get("topic") ?? "");
  return (ARTICLE_TOPICS as string[]).includes(raw) ? (raw as ArticleTopic) : null;
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

  const topic = parseTopic(formData);

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await updateArticle(articleId, { title, body, excerpt, tags, topic }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(articleId, error);
}

/**
 * Session 38 (Keen Africans — Editor Workflow). Autosave — invoked directly
 * from ArticleEditorClient.tsx (a client component) inside startTransition,
 * NOT bound to a <form action>, so it deliberately does not call
 * revalidatePath()/redirect(): either would force a full RSC re-render of
 * the edit page on every autosave tick, resetting the very inputs the
 * user is mid-typing into. Reuses updateArticle() itself — autosave has no
 * separate "draft content" concept, it just means "save what's here,
 * often, so a reload never loses more than a few seconds of typing" — and
 * returns the freshly rendered preview HTML from the SAME
 * renderArticleBodyHtml() pipeline the public page uses, so the live
 * preview is never a second rendering path (this session's explicit "Must
 * NOT").
 */
export async function autosaveArticleAction(
  articleId: string,
  input: { title: string; body: string; excerpt: string; tags: string; topic: string }
): Promise<{ ok: true; savedAt: string; previewHtml: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "not_authenticated" };
  const actor = session.user;

  const title = input.title.trim();
  if (!title) return { ok: false, error: "missing_fields" };

  const tags = input.tags.split(",").map((t) => t.trim()).filter(Boolean);
  const topic = (ARTICLE_TOPICS as string[]).includes(input.topic) ? (input.topic as ArticleTopic) : null;

  try {
    await updateArticle(articleId, { title, body: input.body, excerpt: input.excerpt, tags, topic }, actor);
    return { ok: true, savedAt: new Date().toISOString(), previewHtml: renderArticleBodyHtml(input.body) };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function submitForReviewAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await submitForReview(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(articleId, error);
}

export async function scheduleArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const raw = String(formData.get("scheduledAt") ?? "");
  const scheduledAt = raw ? new Date(raw) : null;

  let error: string | null = null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    error = "invalid_schedule";
  } else {
    try {
      await scheduleArticle(articleId, scheduledAt, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(articleId, error);
}

export async function cancelScheduledPublishAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await cancelScheduledPublish(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(articleId, error);
}

export async function updateArticleSlugAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const slug = String(formData.get("slug") ?? "");

  let error: string | null = null;
  try {
    await updateArticleSlug(articleId, slug, actor);
  } catch (err) {
    error = toError(err);
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
