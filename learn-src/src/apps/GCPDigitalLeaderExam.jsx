import CertReadinessCheck from "./CertReadinessCheck.jsx";
import questions, { DOMAINS } from "../certData/gcpCdl.js";

const examMeta = {
  id: "gcp-cdl",
  title: "Google Cloud Digital Leader Readiness",
  provider: "Google Cloud",
  examCode: "CDL",
  blurb:
    "Practice questions across every Cloud Digital Leader domain: digital transformation, data and AI, infrastructure modernization, security and operations, and scaling with Google Cloud. Built to mirror the real exam's weighting.",
  accent: "#4285f4",
  passingScorePct: 70,
  officialLink: "https://cloud.google.com/learn/certification/cloud-digital-leader",
  lengths: [
    { label: "Quick", count: 20 },
    { label: "Standard", count: 40 },
    { label: "Full-length", count: 60 },
  ],
};

export default function GCPDigitalLeaderExam() {
  return <CertReadinessCheck examMeta={examMeta} domains={DOMAINS} questions={questions} />;
}
