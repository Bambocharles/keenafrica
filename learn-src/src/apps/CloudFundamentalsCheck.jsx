import CertReadinessCheck from "./CertReadinessCheck.jsx";
import questions, { DOMAINS } from "../certData/cloudFundamentals.js";

const examMeta = {
  id: "cloud-fundamentals",
  title: "Cloud Fundamentals Check",
  provider: "AWS, Azure & Google Cloud",
  examCode: "CLOUD",
  kicker: "Certification readiness · All clouds",
  blurb:
    "A provider-agnostic warm-up covering the concepts every cloud certification shares, plus direct AWS ↔ Azure ↔ Google Cloud comparisons. Good starting point before picking a specific certification track.",
  accent: "#2DD4BF",
  passingScorePct: 75,
  lengths: [
    { label: "Quick", count: 20 },
    { label: "Standard", count: 50 },
    { label: "Full-length", count: 100 },
  ],
};

export default function CloudFundamentalsCheck() {
  return <CertReadinessCheck examMeta={examMeta} domains={DOMAINS} questions={questions} />;
}
