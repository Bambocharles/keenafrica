import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessTeacherPortal } from "@/lib/authz";

export default async function TeacherIndex() {
  const session = await auth();
  redirect(canAccessTeacherPortal(session?.user) ? "/dashboard" : "/login");
}
