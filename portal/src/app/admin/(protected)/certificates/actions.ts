"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { revokeCertificate } from "@/lib/certificates";

export async function revokeCertificateAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");

  let error: string | null = null;
  try {
    await revokeCertificate(id, reason, actor);
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "revoke_failed";
  }

  revalidatePath(`/certificates/${id}`);
  revalidatePath("/certificates");
  if (error) redirect(`/certificates/${id}?error=${error}`);
}
