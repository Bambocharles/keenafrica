import { OrganizationHome } from "@/components/organization/OrganizationHome";

export default async function StudentOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; invite?: string }>;
}) {
  return <OrganizationHome mode="onboarding" searchParams={await searchParams} />;
}
