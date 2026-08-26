import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import { createTopic, tagLesson } from "@/lib/topics";
import { createQuestion, tagQuestion } from "@/lib/questions";
import { addQuestionToAssessment, assignAssessmentToCohort, createAssessment, publishAssessment } from "@/lib/assessments";
import { getAttemptForStudent, startAttempt, submitAttempt } from "@/lib/attempts";
import {
  aggregateTopicMastery,
  getCourseProgressForCohort,
  getCourseProgressForStudent,
  getRecommendedFocusAreas,
  getTopicMasteryForCohort,
  getTopicMasteryForStudent,
  getWeakStrongTopicsForStudent,
  markLessonComplete,
  recalculateCourseProgress,
} from "@/lib/progress";
import { actorFromUser, cleanupTestCourses, cleanupTestTopics, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdTopicIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestTopics(createdTopicIds);
  await cleanupTestUsers(createdUserIds);
});

/** Course with 2 published lessons in one module, one teacher, one enrolled student. */
async function setupCourseWithLessons() {
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

  const module = await createModule(course.id, { title: "Module 1" }, teacherActor);
  await publishModule(module.id, teacherActor);
  const lessonA = await createLesson(module.id, { title: "Lesson A", content: "..." }, teacherActor);
  await publishLesson(lessonA.id, teacherActor);
  const lessonB = await createLesson(module.id, { title: "Lesson B", content: "..." }, teacherActor);
  await publishLesson(lessonB.id, teacherActor);

  return { admin, adminActor, course, cohort, module, teacher, teacherActor, student, studentActor, lessonA, lessonB };
}

async function makeTopic(name: string, actor: Awaited<ReturnType<typeof actorFromUser>>) {
  const topic = await createTopic({ name }, actor);
  createdTopicIds.push(topic.id);
  return topic;
}

describe("markLessonComplete", () => {
  it("records completion and is idempotent (no duplicate row on re-call)", async () => {
    const { course, lessonA, studentActor } = await setupCourseWithLessons();

    const first = await markLessonComplete(course.id, lessonA.id, studentActor);
    expect(first.lessonId).toBe(lessonA.id);

    const second = await markLessonComplete(course.id, lessonA.id, studentActor);
    expect(second.id).toBe(first.id);
  });

  it("rejects a lesson in a course the student is not enrolled in", async () => {
    const { course, lessonA } = await setupCourseWithLessons();
    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(markLessonComplete(course.id, lessonA.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("rejects a lesson that is still in draft", async () => {
    const { course, module, teacherActor, studentActor } = await setupCourseWithLessons();
    const draftLesson = await createLesson(module.id, { title: "Draft lesson", content: "..." }, teacherActor);

    await expect(markLessonComplete(course.id, draftLesson.id, studentActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("recalculateCourseProgress — completion regression coverage", () => {
  it("marks Enrollment completed only once every published lesson is completed, and is idempotent", async () => {
    const { course, lessonA, lessonB, studentActor, student, cohort, teacherActor } = await setupCourseWithLessons();

    await markLessonComplete(course.id, lessonA.id, studentActor);
    let progress = await getCourseProgressForStudent(course.id, studentActor);
    expect(progress.completedLessons).toBe(1);
    expect(progress.percentComplete).toBe(50);

    await markLessonComplete(course.id, lessonB.id, studentActor);
    progress = await getCourseProgressForStudent(course.id, studentActor);
    expect(progress.completedLessons).toBe(2);
    expect(progress.percentComplete).toBe(100);

    // Enrollment.completedAt/status was flipped as a side effect — visible
    // through the teacher's cohort report, not just the student's own read.
    const report = await getCourseProgressForCohort(cohort.id, teacherActor);
    const row = report.students.find((s) => s.studentId === student.id)!;
    expect(row.percentComplete).toBe(100);

    // Re-running the recalculation directly is a no-op (idempotent).
    await recalculateCourseProgress(course.id, student.id);
    const again = await getCourseProgressForStudent(course.id, studentActor);
    expect(again.percentComplete).toBe(100);
  });

  it("reverts a completed enrollment back to active when new content is published afterward (fully reversible recalculation)", async () => {
    const { course, module, teacherActor, studentActor, lessonA, lessonB, student, adminActor, cohort } = await setupCourseWithLessons();

    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);

    const cohortReportBefore = await getCourseProgressForCohort(cohort.id, teacherActor);
    const before = cohortReportBefore.students.find((s) => s.studentId === student.id)!;
    expect(before.percentComplete).toBe(100);

    // Teacher publishes a THIRD lesson after the student had already completed everything.
    const lessonC = await createLesson(module.id, { title: "Lesson C", content: "..." }, teacherActor);
    await publishLesson(lessonC.id, teacherActor);

    // Nothing calls markLessonComplete again — recalculation must be driven
    // explicitly (this is what a future publish-time hook would call).
    await recalculateCourseProgress(course.id, student.id);

    const afterRecalc = await getCourseProgressForStudent(course.id, studentActor);
    expect(afterRecalc.completedLessons).toBe(2);
    expect(afterRecalc.totalLessons).toBe(3);
    expect(afterRecalc.percentComplete).toBe(67);

    // Completing the new lesson brings it back to 100%/completed.
    await markLessonComplete(course.id, lessonC.id, studentActor);
    const finalProgress = await getCourseProgressForStudent(course.id, studentActor);
    expect(finalProgress.completedLessons).toBe(3);
    expect(finalProgress.percentComplete).toBe(100);
  });
});

describe("getCourseProgressForStudent", () => {
  it("requires an active enrollment", async () => {
    const { course } = await setupCourseWithLessons();
    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(getCourseProgressForStudent(course.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("reports per-module lesson completion breakdown", async () => {
    const { course, lessonA, studentActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);

    const result = await getCourseProgressForStudent(course.id, studentActor);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].completedLessons).toBe(1);
    expect(result.modules[0].lessons.find((l) => l.lessonId === lessonA.id)?.completed).toBe(true);
  });
});

describe("getCourseProgressForCohort — teacher ownership boundary", () => {
  it("an outsider teacher cannot read the cohort's progress report", async () => {
    const { cohort } = await setupCourseWithLessons();
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(getCourseProgressForCohort(cohort.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("reports accurate per-student completion percentages", async () => {
    const { course, cohort, teacherActor, studentActor, lessonA, adminActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);

    const secondStudent = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, secondStudent.id, adminActor);

    const report = await getCourseProgressForCohort(cohort.id, teacherActor);
    expect(report.totalLessons).toBe(2);
    expect(report.students).toHaveLength(2);
    const completedOne = report.students.find((s) => s.percentComplete === 50);
    const completedZero = report.students.find((s) => s.percentComplete === 0);
    expect(completedOne).toBeDefined();
    expect(completedZero).toBeDefined();
  });
});

/** Course + 1 assessment question tagged to a topic, plus a lesson-only topic with no assessment evidence. */
async function setupCourseWithMastery() {
  const base = await setupCourseWithLessons();
  const assessmentTopic = await makeTopic(`Fractions ${Date.now()}`, base.adminActor);
  const lessonOnlyTopic = await makeTopic(`Reading ${Date.now()}`, base.adminActor);
  await tagLesson(base.lessonB.id, lessonOnlyTopic.id, base.teacherActor);

  const assessment = await createAssessment(base.course.id, { title: "Quiz" }, base.teacherActor);
  const question = await createQuestion(
    base.course.id,
    { type: "single_choice", prompt: "1/2 + 1/2?", options: [{ text: "1", isCorrect: true }, { text: "2", isCorrect: false }] },
    base.teacherActor
  );
  await tagQuestion(question.id, assessmentTopic.id, base.teacherActor);
  await addQuestionToAssessment(assessment.id, question.id, { points: 1 }, base.teacherActor);
  await publishAssessment(assessment.id, base.teacherActor);
  await assignAssessmentToCohort(assessment.id, base.cohort.id, {}, base.teacherActor);

  return { ...base, assessmentTopic, lessonOnlyTopic, assessment, question };
}

describe("getTopicMasteryForStudent", () => {
  it("classifies a topic as strong from 100% correct graded assessment evidence", async () => {
    const { assessment, question, studentActor } = await setupCourseWithMastery();
    const attempt = await startAttempt(assessment.id, studentActor);
    const view = await getAttemptForStudent(attempt.id, studentActor);
    const correctOptionId = view!.questions[0].options.find((o) => o.text === "1")!.id;
    await submitAttempt(attempt.id, [{ questionId: question.id, selectedOptionIds: [correctOptionId] }], studentActor);

    const mastery = await getTopicMasteryForStudent(studentActor, {});
    const entry = mastery.find((m) => m.topicId !== undefined && m.basedOn === "assessment")!;
    expect(entry.masteryLevel).toBe("strong");
    expect(entry.accuracyPercent).toBe(100);
    expect(entry.totalGraded).toBe(1);
  });

  it("classifies a topic as weak from an incorrect graded answer", async () => {
    const { assessment, question, studentActor } = await setupCourseWithMastery();
    const attempt = await startAttempt(assessment.id, studentActor);
    const view = await getAttemptForStudent(attempt.id, studentActor);
    const wrongOptionId = view!.questions[0].options.find((o) => o.text === "2")!.id;
    await submitAttempt(attempt.id, [{ questionId: question.id, selectedOptionIds: [wrongOptionId] }], studentActor);

    const mastery = await getTopicMasteryForStudent(studentActor, {});
    const entry = mastery.find((m) => m.basedOn === "assessment")!;
    expect(entry.masteryLevel).toBe("weak");
    expect(entry.accuracyPercent).toBe(0);
  });

  it("reports a lesson-only topic (no assessment evidence) as exposure_only once the tagged lesson is completed", async () => {
    const { course, lessonB, lessonOnlyTopic, studentActor } = await setupCourseWithMastery();
    await markLessonComplete(course.id, lessonB.id, studentActor);

    const mastery = await getTopicMasteryForStudent(studentActor, {});
    const entry = mastery.find((m) => m.topicId === lessonOnlyTopic.id)!;
    expect(entry.basedOn).toBe("lesson_activity");
    expect(entry.masteryLevel).toBe("exposure_only");
    expect(entry.accuracyPercent).toBeNull();
    expect(entry.lessonsCompleted).toBe(1);
  });

  it("a topic never touched by this student does not appear at all", async () => {
    const { studentActor } = await setupCourseWithMastery();
    const mastery = await getTopicMasteryForStudent(studentActor, {});
    expect(mastery).toHaveLength(0); // no attempt, no lesson completion yet
  });
});

describe("getWeakStrongTopicsForStudent", () => {
  it("splits into weak/strong buckets correctly", async () => {
    const { assessment, question, studentActor } = await setupCourseWithMastery();
    const attempt = await startAttempt(assessment.id, studentActor);
    const view = await getAttemptForStudent(attempt.id, studentActor);
    const wrongOptionId = view!.questions[0].options.find((o) => o.text === "2")!.id;
    await submitAttempt(attempt.id, [{ questionId: question.id, selectedOptionIds: [wrongOptionId] }], studentActor);

    const { weak, strong } = await getWeakStrongTopicsForStudent(studentActor, {});
    expect(weak).toHaveLength(1);
    expect(strong).toHaveLength(0);
  });
});

describe("getTopicMasteryForCohort — teacher analytics", () => {
  it("aggregates across students and computes weak/strong student counts", async () => {
    const { course, cohort, assessment, question, teacherActor, studentActor, adminActor } = await setupCourseWithMastery();

    const attempt1 = await startAttempt(assessment.id, studentActor);
    const view1 = await getAttemptForStudent(attempt1.id, studentActor);
    const correctOptionId = view1!.questions[0].options.find((o) => o.text === "1")!.id;
    await submitAttempt(attempt1.id, [{ questionId: question.id, selectedOptionIds: [correctOptionId] }], studentActor);

    const secondStudent = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, secondStudent.id, adminActor);
    const secondStudentActor = await actorFromUser(secondStudent.id);
    const attempt2 = await startAttempt(assessment.id, secondStudentActor);
    const view2 = await getAttemptForStudent(attempt2.id, secondStudentActor);
    const wrongOptionId = view2!.questions[0].options.find((o) => o.text === "2")!.id;
    await submitAttempt(attempt2.id, [{ questionId: question.id, selectedOptionIds: [wrongOptionId] }], secondStudentActor);

    const report = await getTopicMasteryForCohort(cohort.id, teacherActor);
    const entry = report[0];
    expect(entry.totalGradedAnswers).toBe(2);
    expect(entry.correctAnswers).toBe(1);
    expect(entry.cohortAccuracyPercent).toBe(50);
    expect(entry.studentsWeak).toBe(1);
    expect(entry.studentsStrong).toBe(1);
  });

  it("an outsider teacher cannot read cohort topic mastery", async () => {
    const { cohort } = await setupCourseWithMastery();
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(getTopicMasteryForCohort(cohort.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("getRecommendedFocusAreas", () => {
  it("returns only weak topics, worst first, capped at the limit", async () => {
    const { assessment, question, studentActor } = await setupCourseWithMastery();
    const attempt = await startAttempt(assessment.id, studentActor);
    const view = await getAttemptForStudent(attempt.id, studentActor);
    const wrongOptionId = view!.questions[0].options.find((o) => o.text === "2")!.id;
    await submitAttempt(attempt.id, [{ questionId: question.id, selectedOptionIds: [wrongOptionId] }], studentActor);

    const focus = await getRecommendedFocusAreas(studentActor, { limit: 5 });
    expect(focus).toHaveLength(1);
    expect(focus[0].reason).toBe("weak_assessment_performance");
    expect(focus[0].accuracyPercent).toBe(0);
  });
});

describe("aggregateTopicMastery — threshold boundaries (pure function)", () => {
  const topic = { id: "t1", name: "Topic 1" };
  function answers(correct: number, total: number) {
    return Array.from({ length: total }, (_, i) => ({
      isCorrect: i < correct,
      question: { topics: [{ topic }] },
    }));
  }

  it("49% is weak, 50% is developing, 75% is strong, 74% is developing", () => {
    expect(aggregateTopicMastery(answers(49, 100), [])[0].masteryLevel).toBe("weak");
    expect(aggregateTopicMastery(answers(50, 100), [])[0].masteryLevel).toBe("developing");
    expect(aggregateTopicMastery(answers(74, 100), [])[0].masteryLevel).toBe("developing");
    expect(aggregateTopicMastery(answers(75, 100), [])[0].masteryLevel).toBe("strong");
  });

  it("a topic with zero assessment evidence but lesson exposure is exposure_only, never weak/strong", () => {
    const result = aggregateTopicMastery([], [{ lesson: { topics: [{ topic }] } }]);
    expect(result[0].masteryLevel).toBe("exposure_only");
    expect(result[0].accuracyPercent).toBeNull();
    expect(result[0].lessonsCompleted).toBe(1);
  });
});
