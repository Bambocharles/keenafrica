import { withRls } from "@/lib/rls";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { actorRlsCtx, assertActiveEnrollment } from "@/lib/courses";

/**
 * Student Workspace (Session 06) — "Saved Resources": student-owned
 * bookmarks of a lesson or resource, for quick return access. Same
 * ownership/privacy shape as src/lib/notes.ts — see that file's header.
 */

export type BookmarkTargetType = "lesson" | "resource";

export interface AddBookmarkInput {
  courseId: string;
  targetType: BookmarkTargetType;
  targetId: string;
}

async function assertBookmarkTargetInCourse(
  courseId: string,
  targetType: BookmarkTargetType,
  targetId: string,
  actor: AuthzActor
): Promise<void> {
  const found = await withRls(actorRlsCtx(actor), (tx) => {
    if (targetType === "lesson") {
      return tx.lesson.findFirst({ where: { id: targetId, courseId, status: "published" }, select: { id: true } });
    }
    return tx.resource.findFirst({
      where: { id: targetId, lesson: { courseId, status: "published" } },
      select: { id: true },
    });
  });
  if (!found) throw new AuthorizationError("Bookmark target not found or not visible");
}

/** Requires an active/completed enrollment in courseId. Idempotent — saving an already-bookmarked item is a no-op. */
export async function addBookmark(input: AddBookmarkInput, actor: AuthzActor) {
  await assertActiveEnrollment(input.courseId, actor);
  await assertBookmarkTargetInCourse(input.courseId, input.targetType, input.targetId, actor);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.bookmark.upsert({
      where: {
        studentUserId_targetType_targetId: {
          studentUserId: actor.id,
          targetType: input.targetType,
          targetId: input.targetId,
        },
      },
      create: {
        studentUserId: actor.id,
        courseId: input.courseId,
        targetType: input.targetType,
        targetId: input.targetId,
      },
      update: {},
    })
  );
}

/**
 * Ownership scoped explicitly at the application layer (not left to RLS
 * alone) — see src/lib/notes.ts's updateNote/deleteNote comment for why:
 * the local-dev/test connection is the Postgres superuser and always
 * bypasses RLS. Another student's bookmark id resolves to "not found,"
 * never a distinguishable "forbidden."
 */
export async function removeBookmark(bookmarkId: string, actor: AuthzActor) {
  const bookmark = await withRls(actorRlsCtx(actor), (tx) =>
    tx.bookmark.findFirst({ where: actor.isSuperAdmin ? { id: bookmarkId } : { id: bookmarkId, studentUserId: actor.id } })
  );
  if (!bookmark) throw new Error("Bookmark not found");

  await withRls(actorRlsCtx(actor), (tx) => tx.bookmark.delete({ where: { id: bookmarkId } }));
}

export interface ListBookmarksFilter {
  courseId?: string;
  targetType?: BookmarkTargetType;
}

/** A student's own bookmarks — no permission required beyond self-scoping. */
export async function listMyBookmarks(filter: ListBookmarksFilter, actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.bookmark.findMany({
      where: {
        studentUserId: actor.id,
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
        ...(filter.targetType ? { targetType: filter.targetType } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { course: { select: { id: true, title: true } } },
    })
  );
}
