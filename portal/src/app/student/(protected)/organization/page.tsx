import { OrganizationHome } from "@/components/organization/OrganizationHome";

export default async function StudentOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; invite?: string }>;
}) {
  return <OrganizationHome mode="workspace" searchParams={await searchParams} />;
}
