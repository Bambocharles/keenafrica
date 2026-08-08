"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { withRls } from "@/lib/rls";

const RESERVED_SLUGS = new Set([
  "admin",
  "www",
  "api",
  "app",
  "auth",
  "static",
  "assets",
]);
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) {
    throw new Error("Not authorized");
  }
  return session.user;
}

export async function createSponsor(formData: FormData) {
  const user = await requireSuperAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Sponsor name is required");

  await withRls({ userId: user.id, isSuperAdmin: true }, (tx) =>
    tx.sponsor.create({ data: { name } })
  );

  revalidatePath("/admin/dashboard");
}

export async function createProject(formData: FormData) {
  const user = await requireSuperAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const sponsorId = String(formData.get("sponsorId") ?? "");
  const slugInput = String(formData.get("slug") ?? "").trim().toLowerCase();

  if (!name) throw new Error("Project name is required");
  if (!sponsorId) throw new Error("Sponsor is required");
  if (!SLUG_RE.test(slugInput)) {
    throw new Error(
      "Slug must be 3-40 lowercase letters, numbers, or hyphens"
    );
  }
  if (RESERVED_SLUGS.has(slugInput)) {
    throw new Error(`"${slugInput}" is a reserved slug, choose another`);
  }

  await withRls({ userId: user.id, isSuperAdmin: true }, (tx) =>
    tx.project.create({
      data: { name, slug: slugInput, sponsorId },
    })
  );

  revalidatePath("/admin/dashboard");
}
