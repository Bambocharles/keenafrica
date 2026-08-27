import type { AuthzActor } from "@/lib/authz";
import { actorFromUser } from "@/lib/test-support";
import { enrollStudent, withdrawEnrollment } from "@/lib/courses";
import { markLessonComplete } from "@/lib/progress";
import { startAttempt, submitAttempt, gradeAttempt, type SubmittedAnswerInput } from "@/lib/attempts";
import { issueCertificateIfEligible } from "@/lib/certificates";
import { createNote } from "@/lib/notes";
import { addBookmark } from "@/lib/bookmarks";
import { suspendUser } from "@/lib/users";
import type { DemoCourse, DemoQuestionSpec } from "./content";
import type { DemoUserRef } from "./identity";

type Bucket = "not_started" | "active" | "halfway" | "nearly_complete" | "completed" | "inactive";

// 4 not-started + 5 active + 4 halfway + 3 nearly-complete + 2 completed +
// 2 inactive per 20-student cohort slice = testing/demo-data.md's global
// 20/25/20/15/10/10 split exactly, once applied across all 5 cohorts.
const BUCKET_LAYOUT: Bucket[] = [
  "not_started", "not_started", "not_started", "not_started",
  "active", "active", "active", "active", "active",
  "halfway", "halfway", "halfway", "halfway",
  "nearly_complete", "nearly_complete", "nearly_complete",
  "completed", "completed",
  "inactive", "inactive",
];

const LESSONS_TO_COMPLETE: Record<Bucket, number> = {
  not_started: 0,
  active: 1,
  halfway: 2,
  nearly_complete: 3,
  completed: 4,
  inactive: 1,
};

function buildAnswers(questions: DemoQuestionSpec[], correctness: "all_correct" | "one_wrong" | "two_wrong"): SubmittedAnswerInput[] {
  return questions.map((q, i) => {
    const makeWrong = correctness === "one_wrong" ? i === 0 : correctness === "two_wrong" ? i === 0 || i === 2 : false;

    if (q.type === "short_answer") {
      return { questionId: q.id, textResponse: makeWrong ? (q.weakAnswerText ?? "not sure") : (q.goodAnswerText ?? "") };
    }
    if (q.type === "multiple_choice") {
      return { questionId: q.id, selectedOptionIds: makeWrong ? [q.wrongOptionIds[0]] : q.correctOptionIds };
    }
    return { questionId: q.id, selectedOptionIds: [makeWrong ? q.wrongOptionIds[0] : q.correctOptionIds[0]] };
  });
}

/** Grades the one short_answer question left pending on a manual-grading course's attempt, scoring by whether a "good" or "weak" answer was submitted. */
async function gradePendingShortAnswer(
  attemptId: string,
  course: DemoCourse,
  wasGoodAnswer: boolean,
  graderActor: AuthzActor
): Promise<void> {
  const shortAnswerQuestion = course.questions.find((q) => q.type === "short_answer");
  if (!shortAnswerQuestion) return;
  await gradeAttempt(
    attemptId,
    [{ questionId: shortAnswerQuestion.id, isCorrect: wasGoodAnswer, awardedPoints: wasGoodAnswer ? 1 : 0 }],
    graderActor
  );
}

export interface CohortActivitySummary {
  cohortId: string;
  courseId: string;
  primaryTeacherId: string;
  /** slice index 4 — an "active" student who has an enrollment, one completed lesson, a note, and a bookmark. */
  sampleActiveStudentId: string;
  /** slice index 13 — a "nearly_complete" student, for a second/unanswered messaging thread. */
  sampleNearlyCompleteStudentId: string;
}

export interface StudentActivityResult {
  suspendedStudentIds: string[];
  cohortSummaries: CohortActivitySummary[];
}

/**
 * Drives every cohort's 20-student slice through enrollment, lesson
 * completion, and assessment activity — entirely through the real
 * courses.ts/progress.ts/attempts.ts/certificates.ts API, so Enrollment
 * status/completedAt and Certificate issuance are the platform's OWN
 * derived state (recalculateCourseProgress, issueCertificateIfEligible),
 * never a hand-set field that could drift from what those functions would
 * actually compute.
 */
export async function seedStudentActivity(
  courses: DemoCourse[],
  students: DemoUserRef[],
  adminActor: AuthzActor,
  suspendActor: AuthzActor
): Promise<StudentActivityResult> {
  const suspendedStudentIds: string[] = [];
  const cohortSummaries: CohortActivitySummary[] = [];

  let studentCursor = 0;
  let cohortOrdinal = 0;

  for (const course of courses) {
    for (const cohort of course.cohorts) {
      const slice = students.slice(studentCursor, studentCursor + BUCKET_LAYOUT.length);
      studentCursor += BUCKET_LAYOUT.length;

      // Alternate which grader handles this course's manual-grading questions
      // (when applicable) — cohort A's own teacher grades cohort A, etc.,
      // rather than always the same one.
      const graderActor = await actorFromUser(cohort.teacherIds[0]);

      cohortSummaries.push({
        cohortId: cohort.id,
        courseId: course.id,
        primaryTeacherId: cohort.teacherIds[0],
        sampleActiveStudentId: slice[4].id,
        sampleNearlyCompleteStudentId: slice[13].id,
      });

      let nearlyCompleteSeen = 0;
      let completedSeen = 0;
      let halfwaySeen = 0;

      for (let i = 0; i < slice.length; i++) {
        const student = slice[i];
        const bucket = BUCKET_LAYOUT[i];

        const enrollment = await enrollStudent(cohort.id, student.id, adminActor);
        const studentActor = await actorFromUser(student.id);

        const lessonsToComplete = LESSONS_TO_COMPLETE[bucket];
        for (let li = 0; li < lessonsToComplete; li++) {
          await markLessonComplete(course.id, course.lessonIds[li], studentActor);
        }

        if (bucket === "completed") {
          await issueCertificateIfEligible(course.id, studentActor);
          completedSeen++;

          // Both "completed" students in every cohort attempt the
          // assessment: the first with a perfect score, the second with one
          // wrong answer — real, different scores per testing/demo-data.md.
          const correctness = completedSeen === 1 ? "all_correct" : "one_wrong";
          const attempt = await startAttempt(course.assessmentId, studentActor);
          const submitted = await submitAttempt(attempt.id, buildAnswers(course.questions, correctness), studentActor);
          if (course.requiresManualGrading && submitted) {
            await gradePendingShortAnswer(submitted.attempt.id, course, correctness === "all_correct", graderActor);
          }
        } else if (bucket === "nearly_complete") {
          nearlyCompleteSeen++;
          // Two of the three nearly-complete students attempt the
          // assessment (one lighter score, one heavier); the third hasn't
          // gotten to it yet — realistic partial engagement.
          if (nearlyCompleteSeen <= 2) {
            const correctness = nearlyCompleteSeen === 1 ? "one_wrong" : "two_wrong";
            const attempt = await startAttempt(course.assessmentId, studentActor);
            const submitted = await submitAttempt(attempt.id, buildAnswers(course.questions, correctness), studentActor);
            // Only the first is graded immediately on a manual-grading
            // course — the second is deliberately left "submitted" (pending
            // manual grade), giving the teacher portal a real, populated
            // grading queue instead of every attempt arriving pre-resolved.
            if (course.requiresManualGrading && submitted && nearlyCompleteSeen === 1) {
              await gradePendingShortAnswer(submitted.attempt.id, course, correctness === "one_wrong", graderActor);
            }
          }
        } else if (bucket === "halfway") {
          halfwaySeen++;
          // Exactly one halfway student per cohort has an in-progress
          // attempt they never finished — a realistic "started but didn't
          // submit" state, distinct from "graded" or "no attempt at all".
          if (halfwaySeen === 1) {
            await startAttempt(course.assessmentId, studentActor);
          }
        } else if (bucket === "inactive") {
          // Was active, then stopped — some engagement before withdrawing,
          // distinct from "not_started" (never engaged at all).
          await withdrawEnrollment(enrollment.id, adminActor);
        }

        // A representative student note + bookmark for one student per
        // bucket family (active/halfway/nearly_complete/completed) per
        // cohort — "student notes, bookmarks" per testing/demo-data.md,
        // without doing it for all 100 students.
        if ((bucket === "active" && i === 4) || (bucket === "halfway" && i === 9) || (bucket === "nearly_complete" && i === 13) || (bucket === "completed" && i === 16)) {
          await createNote(
            { courseId: course.id, targetType: "lesson", targetId: course.lessonIds[0], body: "Re-read this before the next session — good refresher." },
            studentActor
          );
          await addBookmark({ courseId: course.id, targetType: "lesson", targetId: course.lessonIds[0] }, studentActor);
        }
      }

      // Suspend exactly one "inactive" student's account per odd-numbered
      // cohort — testing/demo-data.md's "inactive/suspended account
      // examples", distinct from (and additional to) the withdrawn-
      // enrollment state every "inactive" student already has.
      if (cohortOrdinal % 2 === 1) {
        const suspendedStudent = slice[slice.length - 1]; // last "inactive" slot
        await suspendUser(suspendedStudent.id, suspendActor, "Demo: account suspended for extended inactivity");
        suspendedStudentIds.push(suspendedStudent.id);
      }
      cohortOrdinal++;
    }
  }

  return { suspendedStudentIds, cohortSummaries };
}
