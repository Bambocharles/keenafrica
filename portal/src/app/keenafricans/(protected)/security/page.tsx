import { SecurityPanel } from "@/components/security/SecurityPanel";

/**
 * Account & Security (Session 37) — reuses the exact same shared component
 * every other portal's `/security` renders (admin/teacher/student/sponsor)
 * with zero modification, per this session's explicit "reuse Session 20's
 * MFA infrastructure exactly as it exists." This is what makes voluntary
 * TOTP enrollment, change password/email, and the active-sessions list
 * "just work" for a KEEN_AFRICAN account the moment this page exists —
 * MFA_REQUIRED_ROLES (src/lib/mfa.ts) still only covers SUPER_ADMIN, so
 * enrolling here is opt-in for a plain Keen African, never mandatory.
 */
export default async function KeenAfricansSecurityPage({
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
