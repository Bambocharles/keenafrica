"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { deleteOwnKeenAfricanAccount } from "@/lib/articles";
import { MfaError, StepUpRequiredError } from "@/lib/mfa";
import { PrivilegedAccountDeletionError } from "@/lib/users";

/**
 * Account & Security (Session 37) — the "Danger zone" confirmation action.
 * A real, tested, irreversible-with-warning action, not a single accidental
 * click (this session's explicit rule): requires BOTH a typed confirmation
 * phrase (checked here, server-side — never trust a disabled-until-typed
 * button alone) AND a fresh step-up proof (src/lib/mfa.ts's
 * StepUpRequiredError, same tier as changePasswordAction/
 * changeEmailAction/disableMfaAction in src/lib/mfa-actions.ts) before
 * src/lib/articles.ts's deleteOwnKeenAfricanAccount() — the one real entry
 * point for the site owner's anonymize-don't-delete policy — ever runs.
 */
const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

/** Only ever a same-portal relative path — mirrors mfa-actions.ts's sanitizeReturnTo. */
function toStepUpRedirect(returnTo: string): string {
  return `/step-up?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function deleteAccountAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const confirmation = String(formData.get("confirmation") ?? "").trim();
  if (confirmation !== CONFIRMATION_PHRASE) {
    redirect("/account/delete?error=confirmation_mismatch");
  }

  try {
    await deleteOwnKeenAfricanAccount(actor);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      redirect(toStepUpRedirect("/account/delete"));
    }
    if (err instanceof PrivilegedAccountDeletionError) {
      redirect("/account/delete?error=privileged_account");
    }
    if (err instanceof MfaError) {
      redirect("/account/delete?error=action_failed");
    }
    throw err;
  }

  // The account is now fully anonymized and every session (including this
  // one) already revoked by deleteOwnKeenAfricanAccount() itself — this
  // signOut() only clears the now-dead client-side cookie, it doesn't
  // revoke anything further.
  const store = await cookies();
  store.delete("own_reset_link");
  await signOut({ redirectTo: "/login?accountDeleted=1" });
}
