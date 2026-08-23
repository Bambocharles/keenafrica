import CertReadinessCheck from "./CertReadinessCheck.jsx";
import questions, { DOMAINS } from "../certData/ccstNet.js";

const examMeta = {
  id: "ccst-net",
  title: "Cisco CCST Networking Readiness",
  provider: "Cisco",
  examCode: "100-150",
  blurb:
    "Practice questions across every CCST Networking domain: standards and concepts, addressing and subnet formats, endpoints and media types, infrastructure, diagnosing problems, and security. Built to mirror the real exam's weighting.",
  accent: "#049fd9",
  passingScorePct: 70,
  officialLink: "https://www.cisco.com/site/us/en/learn/training-certifications/exams/ccst-networking.html",
  lengths: [
    { label: "Quick", count: 20 },
    { label: "Standard", count: 35 },
    { label: "Full-length", count: 50 },
  ],
};

export default function CiscoCCSTExam() {
  return <CertReadinessCheck examMeta={examMeta} domains={DOMAINS} questions={questions} />;
}
