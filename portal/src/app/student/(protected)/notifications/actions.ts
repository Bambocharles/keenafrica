"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { AuthzActor } from "@/lib/authz";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function markNotificationReadAction(formData: FormData) {
  const actor = await requireActor();
  const notificationId = String(formData.get("notificationId") ?? "");
  await markNotificationRead(notificationId, actor).catch(() => {});
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction() {
  const actor = await requireActor();
  await markAllNotificationsRead(actor);
  revalidatePath("/notifications");
}
