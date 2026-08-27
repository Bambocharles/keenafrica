import type { AuthzActor } from "@/lib/authz";
import { actorFromUser } from "@/lib/test-support";
import { assignTeacherToCohort, createCohort, createCourse, publishCourse } from "@/lib/courses";
import { addResource, createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import { createTopic, tagLesson } from "@/lib/topics";
import { createQuestion, tagQuestion } from "@/lib/questions";
import { addQuestionToAssessment, assignAssessmentToCohort, createAssessment, publishAssessment } from "@/lib/assessments";
import type { DemoUserRef } from "./identity";

export interface DemoQuestionSpec {
  id: string;
  type: "single_choice" | "multiple_choice" | "short_answer";
  correctOptionIds: string[];
  wrongOptionIds: string[];
  /** short_answer only — text that satisfies acceptableAnswers (auto-grade) or, for the manual-grading course, a plausible answer for the teacher to grade. */
  goodAnswerText?: string;
  /** short_answer only — a weaker/partial answer, for score variety. */
  weakAnswerText?: string;
}

export interface DemoCohort {
  id: string;
  name: string;
  teacherIds: string[];
}

export interface DemoCourse {
  id: string;
  title: string;
  lessonIds: string[];
  assessmentId: string;
  questions: DemoQuestionSpec[];
  /** true when the short_answer question has no acceptableAnswers — submissions need gradeAttempt(). */
  requiresManualGrading: boolean;
  cohorts: DemoCohort[];
}

interface CourseBlueprint {
  title: string;
  description: string;
  modules: { title: string; lessons: { title: string; content: string; resourceTitle: string; resourceUrl: string }[] }[];
  topics: string[];
  lessonTopicIndex: number[]; // which topic (index into topics[]) each lesson (flattened) is tagged with
  assessmentTitle: string;
  manualGrading: boolean;
  cohortNames: string[];
}

const BLUEPRINTS: CourseBlueprint[] = [
  {
    title: "Digital Literacy Fundamentals",
    description: "Core computer, internet, and online-safety skills for first-time digital learners.",
    modules: [
      {
        title: "Getting Started with Computers",
        lessons: [
          {
            title: "Using a Keyboard and Mouse",
            content: "Practice the basic keys and pointer actions every computer task relies on.",
            resourceTitle: "Keyboard shortcuts cheat sheet",
            resourceUrl: "https://example.org/demo/keyboard-shortcuts",
          },
          {
            title: "Understanding Files and Folders",
            content: "Learn how to organize documents into folders you can find again later.",
            resourceTitle: "Files and folders walkthrough video",
            resourceUrl: "https://example.org/demo/files-and-folders",
          },
        ],
      },
      {
        title: "Staying Safe Online",
        lessons: [
          {
            title: "Recognizing Phishing and Scams",
            content: "Spot the warning signs of a message trying to steal your information.",
            resourceTitle: "Phishing examples gallery",
            resourceUrl: "https://example.org/demo/phishing-examples",
          },
          {
            title: "Creating Strong Passwords",
            content: "Build passwords that are hard to guess and easy for you to manage.",
            resourceTitle: "Password strength guide",
            resourceUrl: "https://example.org/demo/password-guide",
          },
        ],
      },
    ],
    topics: ["Computer Basics", "Internet Safety"],
    lessonTopicIndex: [0, 0, 1, 1],
    assessmentTitle: "Digital Literacy Check",
    manualGrading: true,
    cohortNames: ["2026 Cohort A", "2026 Cohort B"],
  },
  {
    title: "Financial Literacy for Entrepreneurs",
    description: "Practical budgeting, saving, and credit skills for small-business owners.",
    modules: [
      {
        title: "Budgeting Basics",
        lessons: [
          {
            title: "Tracking Income and Expenses",
            content: "Set up a simple system to record everything coming in and going out.",
            resourceTitle: "Income/expense tracker template",
            resourceUrl: "https://example.org/demo/income-expense-tracker",
          },
          {
            title: "Building a Simple Budget",
            content: "Turn your tracked numbers into a plan for the month ahead.",
            resourceTitle: "Monthly budget worksheet",
            resourceUrl: "https://example.org/demo/monthly-budget",
          },
        ],
      },
      {
        title: "Savings and Credit",
        lessons: [
          {
            title: "Why Saving Matters",
            content: "Understand how a savings cushion protects a small business.",
            resourceTitle: "Savings goals worksheet",
            resourceUrl: "https://example.org/demo/savings-goals",
          },
          {
            title: "Understanding Loans and Interest",
            content: "Learn what a loan actually costs before you borrow.",
            resourceTitle: "Loan cost calculator",
            resourceUrl: "https://example.org/demo/loan-calculator",
          },
        ],
      },
    ],
    topics: ["Budgeting", "Savings & Credit"],
    lessonTopicIndex: [0, 0, 1, 1],
    assessmentTitle: "Financial Literacy Check",
    manualGrading: false,
    cohortNames: ["2026 Cohort A"],
  },
  {
    title: "Agribusiness Essentials",
    description: "Foundational crop management and market-access skills for small-scale farmers.",
    modules: [
      {
        title: "Crop Management",
        lessons: [
          {
            title: "Soil Preparation Basics",
            content: "Learn what healthy soil needs before a single seed goes in the ground.",
            resourceTitle: "Soil testing guide",
            resourceUrl: "https://example.org/demo/soil-testing",
          },
          {
            title: "Managing Pests Naturally",
            content: "Reduce crop loss without relying only on chemical treatments.",
            resourceTitle: "Natural pest control checklist",
            resourceUrl: "https://example.org/demo/pest-control",
          },
        ],
      },
      {
        title: "Reaching the Market",
        lessons: [
          {
            title: "Understanding Market Prices",
            content: "Track how prices move so you know when to sell.",
            resourceTitle: "Market price tracking sheet",
            resourceUrl: "https://example.org/demo/market-prices",
          },
          {
            title: "Building Buyer Relationships",
            content: "Turn one-time sales into repeat business with local buyers.",
            resourceTitle: "Buyer relationship checklist",
            resourceUrl: "https://example.org/demo/buyer-relationships",
          },
        ],
      },
    ],
    topics: ["Crop Management", "Market Access"],
    lessonTopicIndex: [0, 0, 1, 1],
    assessmentTitle: "Agribusiness Check",
    manualGrading: false,
    cohortNames: ["2026 Cohort A", "2026 Cohort B"],
  },
];

interface QuestionBlueprint {
  type: "single_choice" | "multiple_choice" | "short_answer";
  prompt: string;
  explanation: string;
  learningObjective: string;
  options?: { text: string; isCorrect: boolean }[];
  acceptableAnswers?: string[];
  goodAnswerText?: string;
  weakAnswerText?: string;
}

const QUESTION_BLUEPRINTS: QuestionBlueprint[][] = [
  // Digital Literacy Fundamentals — short_answer left ungraded on purpose (manual-grading demo).
  [
    {
      type: "single_choice",
      prompt: "Which key deletes a character to the left of the cursor?",
      explanation: "Backspace removes the character before the cursor.",
      learningObjective: "Identify basic keyboard functions.",
      options: [
        { text: "Backspace", isCorrect: true },
        { text: "Enter", isCorrect: false },
        { text: "Shift", isCorrect: false },
        { text: "Tab", isCorrect: false },
      ],
    },
    {
      type: "single_choice",
      prompt: "Where should you store a document so you can find it again later?",
      explanation: "A labeled folder keeps related files easy to locate.",
      learningObjective: "Apply file organization habits.",
      options: [
        { text: "In a labeled folder", isCorrect: true },
        { text: "Anywhere on the desktop", isCorrect: false },
        { text: "It doesn't matter", isCorrect: false },
        { text: "Delete it after writing", isCorrect: false },
      ],
    },
    {
      type: "multiple_choice",
      prompt: "Which of these are signs of a phishing email? (select all that apply)",
      explanation: "Urgency, mismatched sender addresses, and generic greetings are all common phishing signals.",
      learningObjective: "Recognize phishing attempts.",
      options: [
        { text: "Urgent demand for personal information", isCorrect: true },
        { text: "Sender address that looks slightly wrong", isCorrect: true },
        { text: "A colleague's usual signature", isCorrect: false },
        { text: "A generic greeting like \"Dear Customer\"", isCorrect: true },
      ],
    },
    {
      type: "short_answer",
      prompt: "Name one habit that makes a password strong.",
      explanation: "Length, a mix of character types, and avoiding reused passwords all help.",
      learningObjective: "Describe strong password practices.",
      goodAnswerText: "Using a long mix of letters, numbers, and symbols that isn't reused anywhere else.",
      weakAnswerText: "Make it long.",
    },
  ],
  // Financial Literacy for Entrepreneurs — short_answer auto-graded.
  [
    {
      type: "single_choice",
      prompt: "What is the first step in building a budget?",
      explanation: "You can't plan spending until you know what's coming in.",
      learningObjective: "Explain the budgeting process.",
      options: [
        { text: "List all sources of income", isCorrect: true },
        { text: "Buy inventory", isCorrect: false },
        { text: "Apply for a loan", isCorrect: false },
        { text: "Ignore expenses", isCorrect: false },
      ],
    },
    {
      type: "multiple_choice",
      prompt: "Which of these count as business expenses? (select all that apply)",
      explanation: "Rent, inventory, and insurance are all costs of running the business.",
      learningObjective: "Classify business expenses.",
      options: [
        { text: "Rent", isCorrect: true },
        { text: "Inventory purchases", isCorrect: true },
        { text: "A friend's birthday gift", isCorrect: false },
        { text: "Business insurance", isCorrect: true },
      ],
    },
    {
      type: "single_choice",
      prompt: "Why is an emergency savings fund important?",
      explanation: "It covers unexpected costs without forcing new debt.",
      learningObjective: "Explain the purpose of savings.",
      options: [
        { text: "It covers unexpected costs without new debt", isCorrect: true },
        { text: "It has no real purpose", isCorrect: false },
        { text: "It replaces income permanently", isCorrect: false },
        { text: "It's only useful for large businesses", isCorrect: false },
      ],
    },
    {
      type: "short_answer",
      prompt: "What is one cost of borrowing money?",
      explanation: "Interest is the price paid for borrowing.",
      learningObjective: "Identify the cost of credit.",
      acceptableAnswers: ["interest", "interest rate", "interest payments"],
      goodAnswerText: "interest",
      weakAnswerText: "fees maybe",
    },
  ],
  // Agribusiness Essentials — short_answer auto-graded.
  [
    {
      type: "single_choice",
      prompt: "Why is soil testing useful before planting?",
      explanation: "It reveals what nutrients the soil needs.",
      learningObjective: "Explain the purpose of soil testing.",
      options: [
        { text: "It reveals nutrient needs", isCorrect: true },
        { text: "It has no benefit", isCorrect: false },
        { text: "It replaces watering", isCorrect: false },
        { text: "It only matters for large farms", isCorrect: false },
      ],
    },
    {
      type: "multiple_choice",
      prompt: "Which of these are natural pest-control methods? (select all that apply)",
      explanation: "Crop rotation, companion planting, and natural predators all reduce pests without chemicals.",
      learningObjective: "Identify natural pest management.",
      options: [
        { text: "Crop rotation", isCorrect: true },
        { text: "Companion planting", isCorrect: true },
        { text: "Random chemical spraying", isCorrect: false },
        { text: "Encouraging natural predators", isCorrect: true },
      ],
    },
    {
      type: "single_choice",
      prompt: "Why should a farmer track market prices?",
      explanation: "Tracking prices helps time sales for better income.",
      learningObjective: "Explain the value of market awareness.",
      options: [
        { text: "To time sales for better income", isCorrect: true },
        { text: "Prices never change", isCorrect: false },
        { text: "It's required by law", isCorrect: false },
        { text: "It replaces record-keeping", isCorrect: false },
      ],
    },
    {
      type: "short_answer",
      prompt: "What is one benefit of a strong buyer relationship?",
      explanation: "Trust built over time leads to repeat, reliable sales.",
      learningObjective: "Explain the value of buyer relationships.",
      acceptableAnswers: ["repeat business", "trust", "better prices", "reliable sales"],
      goodAnswerText: "repeat business",
      weakAnswerText: "not sure",
    },
  ],
];

/**
 * Builds all 3 canonical demo courses end to end, following the platform's
 * real vertical slice (PLATFORM_ARCHITECTURE.md's Slice A): admin creates
 * the course/cohorts and assigns teachers, then the assigned TEACHER
 * actor — not the admin — authors and publishes modules/lessons/resources/
 * questions/assessment, exactly like a real teacher would. Cohort/course
 * publish and enrollment happen through the real courses.ts/content.ts/
 * assessments.ts API, never a raw prisma insert, so every RLS ownership
 * rule is exercised by construction rather than assumed.
 */
export async function createDemoCourses(
  adminActor: AuthzActor,
  teachers: DemoUserRef[]
): Promise<DemoCourse[]> {
  // Cohort/teacher wiring, per constants: course 1's second cohort gets two
  // teachers (the "at least one cohort with multiple teachers" requirement);
  // course 3's second cohort reuses teacher1 (a teacher legitimately teaches
  // cohorts across different courses).
  const teacherAssignments: string[][][] = [
    [[teachers[0].id], [teachers[1].id, teachers[2].id]],
    [[teachers[3].id]],
    [[teachers[4].id], [teachers[0].id]],
  ];

  const courses: DemoCourse[] = [];

  for (let ci = 0; ci < BLUEPRINTS.length; ci++) {
    const bp = BLUEPRINTS[ci];
    const course = await createCourse({ title: bp.title, description: bp.description }, adminActor);

    const cohortTeacherIds = teacherAssignments[ci];
    const cohorts: DemoCohort[] = [];
    for (let coi = 0; coi < cohortTeacherIds.length; coi++) {
      const cohort = await createCohort(course.id, { name: bp.cohortNames[coi] }, adminActor);
      for (const teacherId of cohortTeacherIds[coi]) {
        await assignTeacherToCohort(cohort.id, teacherId, adminActor);
      }
      cohorts.push({ id: cohort.id, name: cohort.name, teacherIds: cohortTeacherIds[coi] });
    }

    // The primary teacher (first cohort's first teacher) authors the content —
    // isCourseTeacher() is satisfied by a cohort_teachers row on ANY cohort of
    // the course, so this single teacher's actor is enough to author every
    // module/lesson/question/assessment below.
    const authorActor = await actorFromUser(cohortTeacherIds[0][0]);

    const topicIds: string[] = [];
    for (const topicName of bp.topics) {
      const topic = await createTopic({ name: topicName }, adminActor);
      topicIds.push(topic.id);
    }

    const lessonIds: string[] = [];
    let lessonFlatIndex = 0;
    for (const moduleBp of bp.modules) {
      const module = await createModule(course.id, { title: moduleBp.title }, authorActor);
      for (const lessonBp of moduleBp.lessons) {
        const lesson = await createLesson(module.id, { title: lessonBp.title, content: lessonBp.content }, authorActor);
        await addResource(lesson.id, { title: lessonBp.resourceTitle, url: lessonBp.resourceUrl, type: "link" }, authorActor);
        await tagLesson(lesson.id, topicIds[bp.lessonTopicIndex[lessonFlatIndex]], authorActor);
        await publishLesson(lesson.id, authorActor);
        lessonIds.push(lesson.id);
        lessonFlatIndex++;
      }
      await publishModule(module.id, authorActor);
    }

    const questionBps = QUESTION_BLUEPRINTS[ci];
    const questions: DemoQuestionSpec[] = [];
    const assessment = await createAssessment(
      course.id,
      { title: bp.assessmentTitle, instructions: "Answer every question to the best of your ability.", passingScorePercent: 70 },
      authorActor
    );

    for (let qi = 0; qi < questionBps.length; qi++) {
      const qbp = questionBps[qi];
      const question = await createQuestion(
        course.id,
        {
          type: qbp.type,
          prompt: qbp.prompt,
          explanation: qbp.explanation,
          learningObjective: qbp.learningObjective,
          options: qbp.options,
          acceptableAnswers: qbp.acceptableAnswers,
        },
        authorActor
      );
      // Topic tagging follows the same lesson->topic split as the lessons above.
      await tagQuestion(question.id, topicIds[qi < 2 ? 0 : 1], authorActor);
      await addQuestionToAssessment(assessment.id, question.id, {}, authorActor);

      const correctOptionIds = (question.options ?? []).filter((o) => o.isCorrect).map((o) => o.id);
      const wrongOptionIds = (question.options ?? []).filter((o) => !o.isCorrect).map((o) => o.id);
      questions.push({
        id: question.id,
        type: qbp.type,
        correctOptionIds,
        wrongOptionIds,
        goodAnswerText: qbp.goodAnswerText,
        weakAnswerText: qbp.weakAnswerText,
      });
    }
    await publishAssessment(assessment.id, authorActor);
    // Publishing alone doesn't make an assessment attemptable — startAttempt()
    // requires a real AssessmentAssignment row (cohort- or student-scoped).
    // Every cohort of this course gets one, so any enrolled student can attempt it.
    for (const cohort of cohorts) {
      await assignAssessmentToCohort(assessment.id, cohort.id, {}, authorActor);
    }

    courses.push({
      id: course.id,
      title: course.title,
      lessonIds,
      assessmentId: assessment.id,
      questions,
      requiresManualGrading: bp.manualGrading,
      cohorts,
    });
  }

  return courses;
}

/** Course-level publish, done once every cohort/enrollment is in place (see index.ts) so the resulting notifications reach the actual enrolled roster. */
export async function publishDemoCourses(courses: DemoCourse[], adminActor: AuthzActor): Promise<void> {
  for (const course of courses) {
    await publishCourse(course.id, adminActor);
  }
}
