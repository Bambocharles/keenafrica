import CertReadinessCheck from "./CertReadinessCheck.jsx";
import questions, { DOMAINS } from "../certData/awsCcp.js";

const examMeta = {
  id: "aws-ccp",
  title: "AWS Cloud Practitioner Readiness",
  provider: "Amazon Web Services",
  examCode: "CLF-C02",
  blurb:
    "Practice questions across every CLF-C02 domain: cloud concepts, security and compliance, cloud technology and services, and billing, pricing and support. Built to mirror the real exam's weighting.",
  accent: "#ff9900",
  passingScorePct: 70,
  officialLink: "https://aws.amazon.com/certification/certified-cloud-practitioner/",
  lengths: [
    { label: "Quick", count: 20 },
    { label: "Standard", count: 40 },
    { label: "Full-length", count: 65 },
  ],
};

export default function AWSCloudPractitionerExam() {
  return <CertReadinessCheck examMeta={examMeta} domains={DOMAINS} questions={questions} />;
}
