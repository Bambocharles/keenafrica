import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { createQuestion } from "@/lib/questions";
import { addQuestionToAssessment, assignAssessmentToCohort, createAssessment, publishAssessment } from "@/lib/assessments";
import {
  gradeAttempt,
  getAttemptForStudent,
  getAttemptForTeacher,
  listAttemptsForAssessment,
  listMyResults,
  startAttempt,
  submitAttempt,
} from "@/lib/attempts";
import { actorFromUser, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

async function setupAssignedAssessment(opts?: { maxAttempts?: number; passingScorePercent?: number; withShortAnswer?: boolean }) {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  const student = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, student.id, adminActor);
  const studentActor = await actorFromUser(student.id);

  const assessment = await createAssessment(
    course.id,
    { title: "Quiz", maxAttempts: opts?.maxAttempts, passingScorePercent: opts?.passingScorePercent },
    teacherActor
  );

  const mcQuestion = await createQuestion(
    course.id,
    { type: "single_choice", prompt: "2+2?", options: [{ text: "3", isCorrect: false }, { text: "4", isCorrect: true }] },
    teacherActor
  );
  await addQuestionToAssessment(assessment.id, mcQuestion.id, { points: 2 }, teacherActor);

  let shortAnswerQuestion: Awaited<ReturnType<typeof createQuestion>> | null = null;
  if (opts?.withShortAnswer) {
    shortAnswerQuestion = await createQuestion(course.id, { type: "short_answer", prompt: "Explain why." }, teacherActor);
    await addQuestionToAssessment(assessment.id, shortAnswerQuestion.id, { points: 1 }, teacherActor);
  }

  await publishAssessment(assessment.id, teacherActor);
  await assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor);

  return { admin, adminActor, course, cohort, teacher, teacherActor, student, studentActor, assessment, mcQuestion, shortAnswerQuestion };
}

describe("startAttempt — authorized-assessment boundary", () => {
  it("a student never assigned this assessment cannot start an attempt", async () => {
    const { assessment } = await setupAssignedAssessment();
    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(startAttempt(assessment.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("cannot start an attempt on a draft (unpublished) assessment", async () => {
    const { course, teacherActor, studentActor } = await setupAssignedAssessment();
    const draft = await createAssessment(course.id, { title: "Draft" }, teacherActor);
    await expect(startAttempt(draft.id, studentActor)).rejects.toThrow();
  });

  it("the assigned student can start, and re-calling startAttempt resumes the same in_progress attempt", async () => {
    const { assessment, studentActor } = await setupAssignedAssessment();
    const first = await startAttempt(assessment.id, studentActor);
    expect(first.status).toBe("in_progress");
    expect(first.attemptNumber).toBe(1);

    const second = await startAttempt(assessment.id, studentActor);
    expect(second.id).toBe(first.id);
  });

  it("enforces maxAttempts once no in_progress attempt remains", async () => {
    const { assessment, studentActor, mcQuestion } = await setupAssignedAssessment({ maxAttempts: 1 });
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [] }], studentActor);

    await expect(startAttempt(assessment.id, studentActor)).rejects.toThrow(/[Mm]aximum attempts/);
  });
});

describe("submitAttempt — auto-grading + tamper resistance", () => {
  it("auto-grades single_choice correctly and finalizes to graded when every question is objective", async () => {
    const { assessment, studentActor, mcQuestion } = await setupAssignedAssessment({ passingScorePercent: 50 });
    const attempt = await startAttempt(assessment.id, studentActor);
    const correctOptionId = (
      (await getAttemptForStudent(attempt.id, studentActor))!.questions[0].options.find((o) => o.text === "4")
    )!.id;

    const result = await submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [correctOptionId] }], studentActor);
    expect(result!.attempt.status).toBe("graded");
    expect(result!.attempt.scorePoints).toBe(2);
    expect(result!.attempt.maxPoints).toBe(2);
    expect(result!.attempt.scorePercent).toBe(100);
    expect(result!.attempt.passed).toBe(true);
  });

  it("a wrong answer scores zero and still auto-finalizes", async () => {
    const { assessment, studentActor, mcQuestion } = await setupAssignedAssessment();
    const attempt = await startAttempt(assessment.id, studentActor);
    const wrongOptionId = (
      (await getAttemptForStudent(attempt.id, studentActor))!.questions[0].options.find((o) => o.text === "3")
    )!.id;

    const result = await submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [wrongOptionId] }], studentActor);
    expect(result!.attempt.status).toBe("graded");
    expect(result!.attempt.scorePoints).toBe(0);
  });

  it("a short_answer question with no acceptableAnswers match stays pending, not auto-failed", async () => {
    const { assessment, studentActor, mcQuestion, shortAnswerQuestion } = await setupAssignedAssessment({ withShortAnswer: true });
    const attempt = await startAttempt(assessment.id, studentActor);
    const view = await getAttemptForStudent(attempt.id, studentActor);
    const correctOptionId = view!.questions.find((q) => q.questionId === mcQuestion.id)!.options.find((o) => o.text === "4")!.id;

    const result = await submitAttempt(
      attempt.id,
      [
        { questionId: mcQuestion.id, selectedOptionIds: [correctOptionId] },
        { questionId: shortAnswerQuestion!.id, textResponse: "Because gravity, obviously" },
      ],
      studentActor
    );
    expect(result!.attempt.status).toBe("submitted"); // not graded yet — one question still pending
    const pending = result!.questions.find((q) => q.questionId === shortAnswerQuestion!.id)!;
    expect(pending.graded).toBe(false);
    expect(pending.isCorrect).toBeUndefined(); // answer key not revealed while pending
  });

  it("cannot submit an already-submitted/graded attempt again (no post-submission tampering)", async () => {
    const { assessment, studentActor, mcQuestion } = await setupAssignedAssessment();
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [] }], studentActor);

    await expect(submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [] }], studentActor)).rejects.toThrow(
      AuthorizationError
    );
  });

  it("a student cannot submit answers for another student's attempt", async () => {
    const { assessment, studentActor, mcQuestion, cohort, adminActor } = await setupAssignedAssessment();
    const attempt = await startAttempt(assessment.id, studentActor);

    const otherStudent = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, otherStudent.id, adminActor);
    const otherStudentActor = await actorFromUser(otherStudent.id);

    await expect(submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [] }], otherStudentActor)).rejects.toThrow();
  });

  it("submitting an invalid option id is rejected", async () => {
    const { assessment, studentActor, mcQuestion } = await setupAssignedAssessment();
    const attempt = await startAttempt(assessment.id, studentActor);
    await expect(
      submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: ["00000000-0000-0000-0000-000000000000"] }], studentActor)
    ).rejects.toThrow(/[Ii]nvalid option/);
  });
});

describe("gradeAttempt — manual grading + teacher ownership boundary", () => {
  it("outsider teacher cannot grade", async () => {
    const { assessment, studentActor, mcQuestion, shortAnswerQuestion } = await setupAssignedAssessment({ withShortAnswer: true });
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(
      attempt.id,
      [{ questionId: mcQuestion.id, selectedOptionIds: [] }, { questionId: shortAnswerQuestion!.id, textResponse: "some answer" }],
      studentActor
    );

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(gradeAttempt(attempt.id, [{ questionId: shortAnswerQuestion!.id, isCorrect: true, awardedPoints: 1 }], outsiderActor)).rejects.toThrow(
      AuthorizationError
    );
  });

  it("cannot grade an in_progress attempt", async () => {
    const { assessment, studentActor, teacherActor, shortAnswerQuestion } = await setupAssignedAssessment({ withShortAnswer: true });
    const attempt = await startAttempt(assessment.id, studentActor);
    await expect(gradeAttempt(attempt.id, [{ questionId: shortAnswerQuestion!.id, isCorrect: true, awardedPoints: 1 }], teacherActor)).rejects.toThrow(
      AuthorizationError
    );
  });

  it("grading the last pending question finalizes the attempt and reveals the answer key to the student", async () => {
    const { assessment, studentActor, teacherActor, mcQuestion, shortAnswerQuestion } = await setupAssignedAssessment({
      withShortAnswer: true,
      passingScorePercent: 50,
    });
    const attempt = await startAttempt(assessment.id, studentActor);
    const view = await getAttemptForStudent(attempt.id, studentActor);
    const correctOptionId = view!.questions.find((q) => q.questionId === mcQuestion.id)!.options.find((o) => o.text === "4")!.id;

    await submitAttempt(
      attempt.id,
      [
        { questionId: mcQuestion.id, selectedOptionIds: [correctOptionId] },
        { questionId: shortAnswerQuestion!.id, textResponse: "A thoughtful essay" },
      ],
      studentActor
    );

    const graded = await gradeAttempt(attempt.id, [{ questionId: shortAnswerQuestion!.id, isCorrect: true, awardedPoints: 1 }], teacherActor);
    expect(graded!.attempt.status).toBe("graded");
    expect(graded!.attempt.scorePoints).toBe(3);
    expect(graded!.attempt.maxPoints).toBe(3);
    expect(graded!.attempt.passed).toBe(true);

    const studentView = await getAttemptForStudent(attempt.id, studentActor);
    const shortAnswerView = studentView!.questions.find((q) => q.questionId === shortAnswerQuestion!.id)!;
    expect(shortAnswerView.graded).toBe(true);
    expect(shortAnswerView.isCorrect).toBe(true);
    expect(shortAnswerView.explanation).toBeDefined();
  });
});

describe("results visibility", () => {
  it("a student's own results include this attempt; another student's do not", async () => {
    const { assessment, studentActor, mcQuestion, cohort, adminActor } = await setupAssignedAssessment();
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [] }], studentActor);

    const mine = await listMyResults(studentActor);
    expect(mine.map((a) => a.id)).toContain(attempt.id);

    const otherStudent = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, otherStudent.id, adminActor);
    const otherStudentActor = await actorFromUser(otherStudent.id);
    const theirs = await listMyResults(otherStudentActor);
    expect(theirs.map((a) => a.id)).not.toContain(attempt.id);
  });

  it("listAttemptsForAssessment is ownership-scoped to the course's teacher", async () => {
    const { assessment, studentActor, mcQuestion, teacherActor } = await setupAssignedAssessment();
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(attempt.id, [{ questionId: mcQuestion.id, selectedOptionIds: [] }], studentActor);

    const roster = await listAttemptsForAssessment(assessment.id, teacherActor);
    expect(roster.map((a) => a.id)).toContain(attempt.id);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(listAttemptsForAssessment(assessment.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("getAttemptForTeacher always reveals the answer key, even while pending", async () => {
    const { assessment, studentActor, teacherActor, mcQuestion, shortAnswerQuestion } = await setupAssignedAssessment({ withShortAnswer: true });
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(
      attempt.id,
      [{ questionId: mcQuestion.id, selectedOptionIds: [] }, { questionId: shortAnswerQuestion!.id, textResponse: "pending answer" }],
      studentActor
    );

    const teacherView = await getAttemptForTeacher(attempt.id, teacherActor);
    const mcView = teacherView!.questions.find((q) => q.questionId === mcQuestion.id)!;
    expect(mcView.options.every((o) => o.isCorrect !== undefined)).toBe(true);
  });
});
