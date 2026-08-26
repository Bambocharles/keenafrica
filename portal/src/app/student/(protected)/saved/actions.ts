"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { removeBookmark } from "@/lib/bookmarks";

export async function removeSavedBookmarkAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const bookmarkId = String(formData.get("bookmarkId") ?? "");
  await removeBookmark(bookmarkId, session.user);
  revalidatePath("/saved");
}
