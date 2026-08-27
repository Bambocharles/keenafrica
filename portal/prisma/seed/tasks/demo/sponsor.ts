import type { AuthzActor } from "@/lib/authz";
import {
  createSponsor,
  createProject,
  createMilestone,
  updateMilestone,
  recordProjectMetric,
  addProjectTeamMember,
  addProjectBeneficiary,
  uploadProjectDocument,
} from "@/lib/sponsor";
import type { DemoSponsorUserRef, DemoUserRef } from "./identity";
import { DEMO_SPONSOR_NAMES } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

interface ProjectBlueprint {
  name: string;
  slug: string;
  description: string;
  milestones: { title: string; description: string; targetDateOffsetDays: number; status?: "in_progress" | "achieved" | "missed" }[];
  metrics: { label: string; unit: string; samples: number[] }[];
  documentTitle: string;
  beneficiaryCount: number;
}

interface SponsorBlueprint {
  name: string;
  teamUserIndexes: number[]; // indexes into the 5-element sponsorUsers array
  projects: ProjectBlueprint[];
}

const SPONSOR_BLUEPRINTS: SponsorBlueprint[] = [
  {
    name: DEMO_SPONSOR_NAMES[0],
    teamUserIndexes: [0, 1],
    projects: [
      {
        name: "Girls in STEM Scholarship",
        slug: "girls-in-stem",
        description: "Scholarships and digital-skills coaching for girls pursuing STEM subjects.",
        milestones: [
          { title: "Enroll first scholarship cohort", description: "Select and enroll the first 25 scholars.", targetDateOffsetDays: -60, status: "achieved" },
          { title: "Mid-program mentorship check-in", description: "Pair every scholar with a mentor and confirm engagement.", targetDateOffsetDays: -10, status: "in_progress" },
          { title: "Publish year-one outcomes report", description: "Compile completion and progress outcomes for year one.", targetDateOffsetDays: 45 },
        ],
        metrics: [
          { label: "Beneficiaries reached", unit: "students", samples: [18, 22, 25] },
          { label: "Course completion rate", unit: "%", samples: [40, 58, 64] },
        ],
        documentTitle: "Year-One Program Overview",
        beneficiaryCount: 3,
      },
      {
        name: "Rural Digital Access",
        slug: "rural-digital-access",
        description: "Bringing device access and digital literacy training to rural learning centers.",
        milestones: [
          { title: "Install lab equipment at first center", description: "Set up devices and connectivity at the pilot site.", targetDateOffsetDays: -30, status: "achieved" },
          { title: "Train local facilitators", description: "Run facilitator training for the pilot center.", targetDateOffsetDays: 20 },
        ],
        metrics: [{ label: "Beneficiaries reached", unit: "students", samples: [10, 16] }],
        documentTitle: "Site Readiness Assessment",
        beneficiaryCount: 2,
      },
    ],
  },
  {
    name: DEMO_SPONSOR_NAMES[1],
    teamUserIndexes: [2, 3],
    projects: [
      {
        name: "Youth Entrepreneurship Bootcamp",
        slug: "youth-entrepreneurship",
        description: "Financial literacy and small-business fundamentals for out-of-school youth.",
        milestones: [
          { title: "Recruit first bootcamp intake", description: "Confirm attendance for the pilot cohort.", targetDateOffsetDays: -45, status: "achieved" },
          { title: "Deliver micro-grant pilot", description: "Distribute seed grants to top business plans.", targetDateOffsetDays: -5, status: "missed" },
          { title: "Launch second intake", description: "Open applications for the second cohort.", targetDateOffsetDays: 30 },
        ],
        metrics: [
          { label: "Beneficiaries reached", unit: "students", samples: [30, 33, 33] },
          { label: "Attendance rate", unit: "%", samples: [88, 91, 79] },
        ],
        documentTitle: "Bootcamp Curriculum Summary",
        beneficiaryCount: 2,
      },
    ],
  },
  {
    name: DEMO_SPONSOR_NAMES[2],
    teamUserIndexes: [4],
    projects: [
      {
        name: "Community Health Skills Program",
        slug: "community-health-skills",
        description: "Basic health and financial-literacy training for community health volunteers.",
        milestones: [
          { title: "Onboard volunteer cohort", description: "Recruit and enroll community health volunteers.", targetDateOffsetDays: -20, status: "achieved" },
          { title: "Complete first training cycle", description: "Finish the first full training cycle.", targetDateOffsetDays: 15 },
        ],
        metrics: [{ label: "Beneficiaries reached", unit: "volunteers", samples: [12, 14] }],
        documentTitle: "Program Design Brief",
        beneficiaryCount: 2,
      },
    ],
  },
];

/**
 * Sponsor Core (Session 11) demo data — multiple sponsors/projects,
 * milestones in every status, a metric time series per project (the
 * Reporting session's own consumer, src/lib/sponsor.ts's
 * getProjectImpactSummary), a document, and both sponsor-team membership
 * and student beneficiaries — all through the real sponsor.ts API so
 * ownership-scoping (project_memberships) is real, not implied.
 */
export async function seedSponsorData(
  adminActor: AuthzActor,
  sponsorUsers: DemoSponsorUserRef[],
  students: DemoUserRef[]
): Promise<void> {
  let beneficiaryCursor = 0;

  for (const sponsorBp of SPONSOR_BLUEPRINTS) {
    const sponsor = await createSponsor(sponsorBp.name, adminActor);

    for (const projectBp of sponsorBp.projects) {
      const project = await createProject(
        { sponsorId: sponsor.id, name: projectBp.name, slug: projectBp.slug, description: projectBp.description },
        adminActor
      );

      for (const teamIndex of sponsorBp.teamUserIndexes) {
        await addProjectTeamMember(project.id, sponsorUsers[teamIndex].email, adminActor);
      }

      for (const milestoneBp of projectBp.milestones) {
        const milestone = await createMilestone(
          project.id,
          { title: milestoneBp.title, description: milestoneBp.description, targetDate: daysFromNow(milestoneBp.targetDateOffsetDays) },
          adminActor
        );
        if (milestoneBp.status) {
          await updateMilestone(milestone.id, { status: milestoneBp.status }, adminActor);
        }
      }

      for (const metricBp of projectBp.metrics) {
        for (let i = 0; i < metricBp.samples.length; i++) {
          await recordProjectMetric(
            project.id,
            { label: metricBp.label, value: metricBp.samples[i], unit: metricBp.unit, recordedAt: daysFromNow(-30 * (metricBp.samples.length - i)) },
            adminActor
          );
        }
      }

      await uploadProjectDocument(
        project.id,
        {
          title: projectBp.documentTitle,
          originalFilename: `${projectBp.slug}-overview.txt`,
          declaredMimeType: "text/plain",
          buffer: Buffer.from(`${projectBp.name}\n\n${projectBp.description}\n`, "utf-8"),
        },
        adminActor
      );

      for (let b = 0; b < projectBp.beneficiaryCount; b++) {
        const student = students[beneficiaryCursor % students.length];
        beneficiaryCursor++;
        await addProjectBeneficiary(project.id, student.email, adminActor);
      }
    }
  }
}
