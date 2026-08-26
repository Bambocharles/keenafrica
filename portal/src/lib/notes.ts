import { withRls } from "@/lib/rls";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { actorRlsCtx, assertActiveEnrollment } from "@/lib/courses";

/**
 * Student Workspace (Session 06) — private, student-owned notes attachable
 * to a course/module/lesson/resource/question. Not part of Education Core
 * (Course/Module/Lesson/Enrollment stay Session 04's canonical entities,
 * only ever referenced here) and not a messaging/comment system — these
 * rows are visible to nobody but their owner, enforced independently at
 * the RLS layer (see the student_workspace migration), same defense-in-
 * depth shape as Session 04's draft-content visibility.
 */

export type NoteTargetType = "course" | "module" | "lesson" | "resource" | "question";

export interface CreateNoteInput {
  courseId: string;
  targetType: NoteTargetType;
  targetId: string;
  body: string;
}

/**
 * Verifies targetId actually belongs to courseId and — for module/lesson/
 * resource — is currently published/visible to this student, not a draft
 * they have no business referencing. "question" has no table yet (Session
 * 07 hasn't built Assessment) so it can't be validated this way; accepted
 * as-is and left for Session 07 to tighten once Question exists.
 */
async function assertNoteTargetInCourse(
  courseId: string,
  targetType: NoteTargetType,
  targetId: string,
  actor: AuthzActor
): Promise<void> {
  if (targetType === "course") {
    if (targetId !== courseId) throw new AuthorizationError("Note target does not match its course");
    return;
  }
  if (targetType === "question") return;

  const found = await withRls(actorRlsCtx(actor), (tx) => {
    if (targetType === "module") {
      return tx.module.findFirst({ where: { id: targetId, courseId, status: "published" }, select: { id: true } });
    }
    if (targetType === "lesson") {
      return tx.lesson.findFirst({ where: { id: targetId, courseId, status: "published" }, select: { id: true } });
    }
    return tx.resource.findFirst({
      where: { id: targetId, lesson: { courseId, status: "published" } },
      select: { id: true },
    });
  });
  if (!found) throw new AuthorizationError("Note target not found or not visible");
}

/** Requires an active/completed enrollment in courseId. Throws AuthorizationError otherwise. */
export async function createNote(input: CreateNoteInput, actor: AuthzActor) {
  await assertActiveEnrollment(input.courseId, actor);
  await assertNoteTargetInCourse(input.courseId, input.targetType, input.targetId, actor);

  const body = input.body.trim();
  if (!body) throw new Error("Note body is required");

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.studentNote.create({
      data: {
        studentUserId: actor.id,
        courseId: input.courseId,
        targetType: input.targetType,
        targetId: input.targetId,
        body,
      },
    })
  );
}

/**
 * Ownership is checked explicitly here at the application layer, not left
 * to RLS alone: the local-dev/test `prisma` connection is the Postgres
 * superuser, which always bypasses RLS regardless of policy (see
 * src/lib/rls.integration.test.ts's header comment) — an app-layer query
 * with no owner filter would silently succeed for ANY note under that
 * connection even though production's non-superuser app role would have
 * been stopped by the student_notes_select/update/delete policies. Scoping
 * the lookup by studentUserId here mirrors what RLS enforces independently
 * in production, the same defense-in-depth shape Session 04 documents for
 * draft-content visibility. A lookup for someone else's note id resolves
 * to "not found," never a distinguishable "forbidden," so this doesn't
 * confirm another student's note id even exists.
 */
export async function updateNote(noteId: string, body: string, actor: AuthzActor) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Note body is required");

  const note = await withRls(actorRlsCtx(actor), (tx) =>
    tx.studentNote.findFirst({ where: actor.isSuperAdmin ? { id: noteId } : { id: noteId, studentUserId: actor.id } })
  );
  if (!note) throw new Error("Note not found");

  return withRls(actorRlsCtx(actor), (tx) => tx.studentNote.update({ where: { id: noteId }, data: { body: trimmed } }));
}

export async function deleteNote(noteId: string, actor: AuthzActor) {
  const note = await withRls(actorRlsCtx(actor), (tx) =>
    tx.studentNote.findFirst({ where: actor.isSuperAdmin ? { id: noteId } : { id: noteId, studentUserId: actor.id } })
  );
  if (!note) throw new Error("Note not found");

  await withRls(actorRlsCtx(actor), (tx) => tx.studentNote.delete({ where: { id: noteId } }));
}

export interface ListNotesFilter {
  courseId?: string;
  targetType?: NoteTargetType;
  targetId?: string;
}

/** A student's own notes — no permission required beyond self-scoping (mirrors listMyEnrollments()). */
export async function listMyNotes(filter: ListNotesFilter, actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.studentNote.findMany({
      where: {
        studentUserId: actor.id,
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
        ...(filter.targetType ? { targetType: filter.targetType } : {}),
        ...(filter.targetId ? { targetId: filter.targetId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: { course: { select: { id: true, title: true } } },
    })
  );
}
