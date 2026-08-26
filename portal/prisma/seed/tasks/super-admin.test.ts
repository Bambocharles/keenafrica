import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { compare } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { superAdminTask } from "./super-admin";

const prisma = new PrismaClient();
const ORIGINAL_ENV = { ...process.env };
const createdEmails: string[] = [];

afterEach(async () => {
  process.env.SUPER_ADMIN_EMAIL = ORIGINAL_ENV.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_PASSWORD = ORIGINAL_ENV.SUPER_ADMIN_PASSWORD;
  process.env.SUPER_ADMIN_NAME = ORIGINAL_ENV.SUPER_ADMIN_NAME;
  if (createdEmails.length) {
    const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
    const userIds = users.map((u) => u.id);
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    createdEmails.length = 0;
  }
});

describe("superAdminTask", () => {
  it("does nothing when the env vars are unset", async () => {
    delete process.env.SUPER_ADMIN_EMAIL;
    delete process.env.SUPER_ADMIN_PASSWORD;
    await expect(superAdminTask.run(prisma)).resolves.not.toThrow();
  });

  it("creates a new super admin with the given password", async () => {
    const email = `super-admin-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    process.env.SUPER_ADMIN_EMAIL = email;
    process.env.SUPER_ADMIN_PASSWORD = "InitialPassword123!";

    await superAdminTask.run(prisma);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.isSuperAdmin).toBe(true);
    expect(await compare("InitialPassword123!", user.passwordHash)).toBe(true);
  });

  it("never overwrites the password of an account that already exists — the actual production risk this guards against", async () => {
    const email = `super-admin-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    process.env.SUPER_ADMIN_EMAIL = email;
    process.env.SUPER_ADMIN_PASSWORD = "InitialPassword123!";
    await superAdminTask.run(prisma);

    // Re-running with a different (e.g. stale/placeholder) password must
    // not change what's already live — this is exactly the scenario of
    // re-running the seed against production to pick up new role/
    // permission data without an operator carefully re-typing the real
    // current password.
    process.env.SUPER_ADMIN_PASSWORD = "SomeDifferentPassword456!";
    await superAdminTask.run(prisma);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await compare("InitialPassword123!", user.passwordHash)).toBe(true);
    expect(await compare("SomeDifferentPassword456!", user.passwordHash)).toBe(false);
  });

  it("still keeps isSuperAdmin/name current on repeat runs", async () => {
    const email = `super-admin-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    process.env.SUPER_ADMIN_EMAIL = email;
    process.env.SUPER_ADMIN_PASSWORD = "InitialPassword123!";
    process.env.SUPER_ADMIN_NAME = "First Name";
    await superAdminTask.run(prisma);

    process.env.SUPER_ADMIN_NAME = "Updated Name";
    await superAdminTask.run(prisma);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toBe("Updated Name");
    expect(user.isSuperAdmin).toBe(true);
  });
});
