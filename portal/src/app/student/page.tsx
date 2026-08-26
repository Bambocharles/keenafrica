import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessStudentPortal } from "@/lib/authz";

export default async function StudentIndex() {
  const session = await auth();
  redirect(canAccessStudentPortal(session?.user) ? "/dashboard" : "/login");
}
