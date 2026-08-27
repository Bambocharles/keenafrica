import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { createUser } from "@/lib/users";
import { actorFromUser } from "@/lib/test-support";
import type { AuthzActor } from "@/lib/authz";
import { DEMO_PASSWORD, demoEmail, studentName } from "./constants";

export interface DemoUserRef {
  id: string;
  email: string;
  name: string;
}

export interface DemoSponsorUserRef extends DemoUserRef {
  role: "SPONSOR_ADMIN" | "SPONSOR_USER";
}

export interface DemoIdentities {
  superAdminActor: AuthzActor;
  admins: DemoUserRef[];
  troubleshooters: DemoUserRef[];
  teachers: DemoUserRef[];
  students: DemoUserRef[];
  sponsorUsers: DemoSponsorUserRef[];
}

/**
 * The demo super-admin is bootstrapped with a direct `prisma.user.create`,
 * the same pattern ../super-admin.ts (core) already establishes for exactly
 * this reason: createUser() (src/lib/users.ts) requires an actor who
 * already holds users.create, and this is the very first demo account —
 * there is no demo actor yet to hold it. Every other demo account below is
 * created through createUser(), the canonical entry point
 * (CLAUDE_BUILD_RULES.md §3 — "never create parallel systems").
 *
 * Deliberately a SEPARATE super-admin account from whatever real one
 * SUPER_ADMIN_EMAIL/../super-admin.ts may have bootstrapped — that account
 * is a real operator credential; this one is a synthetic,
 * @demo.keenafrica.dev-domain account that testing/demo-data.md's "1 super
 * administrator" requirement calls for as part of the disposable demo
 * universe, safe to hand to any QA person alongside the rest of this file's
 * accounts.
 */
async function bootstrapDemoSuperAdmin(): Promise<AuthzActor> {
  const email = demoEmail("superadmin");
  const passwordHash = await hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.create({
    data: { email, name: "Demo Super Admin", passwordHash, isSuperAdmin: true },
  });

  const superAdminRole = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
  if (superAdminRole) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id } });
  }

  return actorFromUser(user.id);
}

export async function createDemoIdentities(): Promise<DemoIdentities> {
  const superAdminActor = await bootstrapDemoSuperAdmin();

  const admins: DemoUserRef[] = [];
  for (const [local, name] of [
    ["admin1", "Chinelo Adeyemi"],
    ["admin2", "Samuel Diallo"],
  ] as const) {
    const u = await createUser({ email: demoEmail(local), name, password: DEMO_PASSWORD, roles: ["ADMIN"] }, superAdminActor);
    admins.push({ id: u.id, email: u.email, name: u.name });
  }

  const troubleshooters: DemoUserRef[] = [];
  for (const [local, name] of [
    ["troubleshooter1", "Grace Chikwanha"],
    ["troubleshooter2", "Ibrahim Suleiman"],
  ] as const) {
    const u = await createUser(
      { email: demoEmail(local), name, password: DEMO_PASSWORD, roles: ["TROUBLESHOOTER"] },
      superAdminActor
    );
    troubleshooters.push({ id: u.id, email: u.email, name: u.name });
  }

  const teachers: DemoUserRef[] = [];
  for (const [local, name] of [
    ["teacher1", "Amara Okafor"],
    ["teacher2", "Kwame Mensah"],
    ["teacher3", "Fatima Bello"],
    ["teacher4", "Wanjiru Kamau"],
    ["teacher5", "Tendai Moyo"],
  ] as const) {
    const u = await createUser({ email: demoEmail(local), name, password: DEMO_PASSWORD, roles: ["TEACHER"] }, superAdminActor);
    teachers.push({ id: u.id, email: u.email, name: u.name });
  }

  const students: DemoUserRef[] = [];
  const STUDENT_COUNT = 100;
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const local = `student${String(i + 1).padStart(3, "0")}`;
    const name = studentName(i);
    const u = await createUser({ email: demoEmail(local), name, password: DEMO_PASSWORD, roles: ["STUDENT"] }, superAdminActor);
    students.push({ id: u.id, email: u.email, name: u.name });
  }

  const sponsorUsers: DemoSponsorUserRef[] = [];
  for (const [local, name, role] of [
    ["sponsor1-admin", "Chioma Eze", "SPONSOR_ADMIN"],
    ["sponsor1-user", "David Mwangi", "SPONSOR_USER"],
    ["sponsor2-admin", "Aisha Traore", "SPONSOR_ADMIN"],
    ["sponsor2-user", "Peter Osei", "SPONSOR_USER"],
    ["sponsor3-admin", "Halima Abubakar", "SPONSOR_ADMIN"],
  ] as const) {
    const u = await createUser({ email: demoEmail(local), name, password: DEMO_PASSWORD, roles: [role] }, superAdminActor);
    sponsorUsers.push({ id: u.id, email: u.email, name: u.name, role });
  }

  return { superAdminActor, admins, troubleshooters, teachers, students, sponsorUsers };
}
