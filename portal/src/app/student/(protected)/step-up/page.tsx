import { StepUpChallenge } from "@/components/security/StepUpChallenge";

export default async function StudentStepUpPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  return <StepUpChallenge searchParams={await searchParams} />;
}
