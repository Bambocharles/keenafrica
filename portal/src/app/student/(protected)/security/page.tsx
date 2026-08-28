import { SecurityPanel } from "@/components/security/SecurityPanel";

export default async function StudentSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{
    enroll?: string;
    codes?: string;
    error?: string;
    disabled?: string;
    passwordChanged?: string;
    emailChanged?: string;
  }>;
}) {
  return <SecurityPanel searchParams={await searchParams} />;
}
