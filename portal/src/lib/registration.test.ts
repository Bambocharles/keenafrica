import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/registration";
import { acceptOrganizationInvitation, createOrganization, inviteToOrganization } from "@/lib/organizations";
import { onDomainEvent } from "@/lib/events";
import { actorFromUser, cleanupTestOrganizations, cleanupTestUsers } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

afterAll(async () => {
  await cleanupTestOrganizations(createdOrgIds);
  await cleanupTestUsers(createdUserIds);
});

function uniqueEmail(): string {
  return `register-test-${randomUUID()}@example.com`;
}

describe("registerUser", () => {
  it("creates a new active User + a single UserRole row, hashes the password, and never returns it", async () => {
    const email = uniqueEmail();
    const outcome = await registerUser({ email, password: "correct-horse-1", name: "New Teacher", role: "TEACHER" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    createdUserIds.push(outcome.userId);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: outcome.userId } });
    expect(row.email.toLowerCase()).toBe(email.toLowerCase());
    expect(row.status).toBe("active");
    expect(row.isSuperAdmin).toBe(false);
    expect(row.passwordHash).not.toBe("correct-horse-1");
    expect(await compare("correct-horse-1", row.passwordHash!)).toBe(true);

    const roles = await prisma.userRole.findMany({ where: { userId: outcome.userId }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(["TEACHER"]);
  });

  it("registers a STUDENT role account the same way", async () => {
    const email = uniqueEmail();
    const outcome = await registerUser({ email, password: "correct-horse-1", name: "New Student", role: "STUDENT" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    createdUserIds.push(outcome.userId);

    const roles = await prisma.userRole.findMany({ where: { userId: outcome.userId }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(["STUDENT"]);
  });

  it("rejects a duplicate email (case-insensitively) without creating a second account", async () => {
    const email = uniqueEmail();
    const first = await registerUser({ email, password: "correct-horse-1", name: "First", role: "STUDENT" });
    expect(first.ok).toBe(true);
    if (first.ok) createdUserIds.push(first.userId);

    const second = await registerUser({ email: email.toUpperCase(), password: "another-pass-1", name: "Second", role: "STUDENT" });
    expect(second).toEqual({ ok: false, error: "email_taken" });

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const outcome = await registerUser({ email: uniqueEmail(), password: "short1", name: "Weak", role: "STUDENT" });
    expect(outcome).toEqual({ ok: false, error: "weak_password" });
  });

  it("rejects a missing name or malformed email", async () => {
    expect(await registerUser({ email: "not-an-email", password: "correct-horse-1", name: "Someone", role: "STUDENT" })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(await registerUser({ email: uniqueEmail(), password: "correct-horse-1", name: "  ", role: "STUDENT" })).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("rejects a role outside TEACHER/STUDENT — no public path to an ADMIN/SPONSOR_* account", async () => {
    const outcome = await registerUser({
      email: uniqueEmail(),
      password: "correct-horse-1",
      name: "Nope",
      // @ts-expect-error — deliberately an unregisterable role, proving the runtime guard.
      role: "ADMIN",
    });
    expect(outcome).toEqual({ ok: false, error: "invalid_role" });
  });

  it("emits UserCreated and records a user.registered audit event", async () => {
    const email = uniqueEmail();
    let seenUserId: string | null = null;
    const off = onDomainEvent("UserCreated", (payload) => {
      seenUserId = payload.userId;
    });

    const outcome = await registerUser({ email, password: "correct-horse-1", name: "Audited", role: "TEACHER" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    createdUserIds.push(outcome.userId);

    // Domain events are emitted synchronously (node:events) but this test's
    // own handler runs in the same tick — no await needed beyond the call
    // above having already completed.
    expect(seenUserId).toBe(outcome.userId);
    off();

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: outcome.userId, action: "user.registered" } });
    expect(audit).not.toBeNull();
  });

  it("a registered user can immediately redeem a pending email-based organization invitation at the offered role", async () => {
    const founderEmail = uniqueEmail();
    const founder = await registerUser({ email: founderEmail, password: "correct-horse-1", name: "Founder", role: "TEACHER" });
    expect(founder.ok).toBe(true);
    if (!founder.ok) return;
    createdUserIds.push(founder.userId);
    const founderActor = await actorFromUser(founder.userId);

    const org = await createOrganization({ name: `Reg Test Org ${randomUUID()}`, slug: `reg-test-org-${randomUUID()}` }, founderActor);
    createdOrgIds.push(org.id);

    const invitedEmail = uniqueEmail();
    const invite = await inviteToOrganization(org.id, invitedEmail, "org_member", founderActor);
    expect(invite.mode).toBe("email_invitation");
    if (invite.mode !== "email_invitation") return;

    const registered = await registerUser({ email: invitedEmail, password: "correct-horse-1", name: "Invitee", role: "STUDENT" });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    createdUserIds.push(registered.userId);

    const registeredActor = await actorFromUser(registered.userId);
    const outcome = await acceptOrganizationInvitation(invite.token, registeredActor);
    expect(outcome).toBe("ok");

    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: registered.userId } },
    });
    expect(membership?.status).toBe("active");
    expect(membership?.role).toBe("org_member");
  });
});
