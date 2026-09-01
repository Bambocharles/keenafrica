import { StepUpChallenge } from "@/components/security/StepUpChallenge";

/**
 * Account & Security (Session 37) — reuses the exact same shared component
 * every other portal's `/step-up` renders, unmodified. Reached whenever
 * changePasswordAction/changeEmailAction/beginEnrollmentAction/
 * disableMfaAction/regenerateRecoveryCodesAction, or this session's own
 * deleteAccountAction, throws mfa.ts's StepUpRequiredError.
 */
export default async function KeenAfricansStepUpPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  return <StepUpChallenge searchParams={await searchParams} />;
}
