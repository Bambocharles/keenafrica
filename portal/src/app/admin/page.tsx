import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessAdminConsole } from "@/lib/authz";

export default async function AdminIndex() {
  const session = await auth();
  redirect(canAccessAdminConsole(session?.user) ? "/dashboard" : "/login");
}
