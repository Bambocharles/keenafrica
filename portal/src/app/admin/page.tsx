import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function AdminIndex() {
  const session = await auth();
  redirect(session?.user?.isSuperAdmin ? "/admin/dashboard" : "/admin/login");
}
