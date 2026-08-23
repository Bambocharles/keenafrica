import CertReadinessCheck from "./CertReadinessCheck.jsx";
import questions, { DOMAINS } from "../certData/az900.js";

const examMeta = {
  id: "az900",
  title: "AZ-900 Exam Readiness",
  provider: "Microsoft Azure",
  examCode: "AZ-900",
  blurb:
    "Practice questions across every AZ-900 domain: cloud concepts, Azure architecture and services, and Azure management and governance. Built to mirror the real exam's weighting.",
  accent: "#0078d4",
  passingScorePct: 70,
  officialLink: "https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/",
  lengths: [
    { label: "Quick", count: 20 },
    { label: "Standard", count: 40 },
    { label: "Full-length", count: 60 },
  ],
};

export default function AZ900Exam() {
  return <CertReadinessCheck examMeta={examMeta} domains={DOMAINS} questions={questions} />;
}
