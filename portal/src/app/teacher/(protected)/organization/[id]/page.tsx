import { OrganizationManage } from "@/components/organization/OrganizationManage";

export default async function TeacherOrganizationManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; inviteLinkKey?: string }>;
}) {
  const { id } = await params;
  return <OrganizationManage organizationId={id} searchParams={await searchParams} />;
}
