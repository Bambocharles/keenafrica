import { afterAll, describe, expect, it } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, resolveSessionAuthz } from "@/lib/sessions";
import { generateTotpCode } from "@/lib/mfa-crypto";
import {
  MfaError,
  StepUpRequiredError,
  beginTotpEnrollment,
  completeLoginMfa,
  confirmTotpEnrollment,
  disableMfa,
  getMfaStatus,
  policyRequiresMfa,
  regenerateRecoveryCodes,
  requireStepUp,
  shouldRequireLoginMfa,
  verifyStepUp,
} from "@/lib/mfa";
import { actorFromUser, cleanupTestUsers, createTestUser, steppedUpActorFromUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

/** Enrolls and confirms TOTP for a user, returning the secret (so tests can generate valid codes) and the recovery codes. */
async function enrollTotp(userId: string) {
  const actor = await actorFromUser(userId);
  const { secretBase32 } = await beginTotpEnrollment(actor, "test@example.com");
  const { recoveryCodes } = await confirmTotpEnrollment(actor, generateTotpCode(secretBase32));
  return { secretBase32, recoveryCodes };
}

describe("policyRequiresMfa / shouldRequireLoginMfa — the policy hook", () => {
  it("SUPER_ADMIN always requires MFA, even with nothing enrolled", () => {
    expect(policyRequiresMfa(["SUPER_ADMIN"])).toBe(true);
    expect(policyRequiresMfa(["TEACHER"])).toBe(false);
  });

  it("a plain user with nothing enrolled and no covered role does not require login MFA", async () => {
    const u = await user({ roles: ["TEACHER"] });
    expect(await shouldRequireLoginMfa(u.id)).toBe(false);
  });

  it("a SUPER_ADMIN-role user requires login MFA even before enrolling", async () => {
    const u = await user({ roles: ["SUPER_ADMIN"] });
    expect(await shouldRequireLoginMfa(u.id)).toBe(true);
  });

  it("once TOTP is enabled, login MFA is required regardless of role", async () => {
    const u = await user({ roles: ["TEACHER"] });
    expect(await shouldRequireLoginMfa(u.id)).toBe(false);
    await enrollTotp(u.id);
    expect(await shouldRequireLoginMfa(u.id)).toBe(true);
  });
});

describe("TOTP enrollment", () => {
  it("begin -> confirm with the right code enables MFA and issues 10 recovery codes", async () => {
    const u = await user();
    const actor = await actorFromUser(u.id);

    let status = await getMfaStatus(actor);
    expect(status.enabled).toBe(false);

    const { secretBase32 } = await beginTotpEnrollment(actor, "test@example.com");
    status = await getMfaStatus(actor);
    expect(status.enabled).toBe(false);
    expect(status.pendingEnrollment).toBe(true);

    const { recoveryCodes } = await confirmTotpEnrollment(actor, generateTotpCode(secretBase32));
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    status = await getMfaStatus(actor);
    expect(status.enabled).toBe(true);
    expect(status.recoveryCodesRemaining).toBe(10);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "mfa.enabled", entityId: u.id } });
    expect(audit).not.toBeNull();
  });

  it("confirming with the wrong code fails and does not enable MFA", async () => {
    const u = await user();
    const actor = await actorFromUser(u.id);
    await beginTotpEnrollment(actor, "test@example.com");

    await expect(confirmTotpEnrollment(actor, "000000")).rejects.toThrow(MfaError);

    const status = await getMfaStatus(actor);
    expect(status.enabled).toBe(false);
  });

  it("beginning enrollment when nothing is enabled yet needs no step-up", async () => {
    const u = await user();
    const actor = await actorFromUser(u.id); // no sessionId — would fail requireStepUp() if it were called
    await expect(beginTotpEnrollment(actor, "test@example.com")).resolves.toBeDefined();
  });

  it("replacing an ALREADY-enabled credential requires step-up", async () => {
    const u = await user();
    await enrollTotp(u.id);
    const actor = await actorFromUser(u.id); // not stepped up

    await expect(beginTotpEnrollment(actor, "test@example.com")).rejects.toThrow(StepUpRequiredError);
  });

  it("replacing an already-enabled credential WITH step-up succeeds and returns to pendingEnrollment", async () => {
    const u = await user();
    await enrollTotp(u.id);
    const steppedUp = await steppedUpActorFromUser(u.id);

    await beginTotpEnrollment(steppedUp, "test@example.com");
    const status = await getMfaStatus(steppedUp);
    expect(status.enabled).toBe(false);
    expect(status.pendingEnrollment).toBe(true);
  });
});

describe("disableMfa — always step-up gated", () => {
  it("is rejected without a fresh step-up proof, and MFA stays enabled", async () => {
    const u = await user();
    await enrollTotp(u.id);
    const actor = await actorFromUser(u.id);

    await expect(disableMfa(actor)).rejects.toThrow(StepUpRequiredError);
    expect((await getMfaStatus(actor)).enabled).toBe(true);
  });

  it("succeeds with a fresh step-up proof and removes the credential + recovery codes", async () => {
    const u = await user();
    await enrollTotp(u.id);
    const steppedUp = await steppedUpActorFromUser(u.id);

    await disableMfa(steppedUp);

    const status = await getMfaStatus(steppedUp);
    expect(status.enabled).toBe(false);
    const remainingCodes = await prisma.recoveryCode.count({ where: { userId: u.id } });
    expect(remainingCodes).toBe(0);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "mfa.disabled", entityId: u.id } });
    expect(audit).not.toBeNull();
  });

  it("throws if MFA isn't enabled at all, even with step-up", async () => {
    const u = await user();
    const steppedUp = await steppedUpActorFromUser(u.id);
    await expect(disableMfa(steppedUp)).rejects.toThrow(MfaError);
  });
});

describe("regenerateRecoveryCodes — step-up gated, invalidates the old batch", () => {
  it("is rejected without step-up", async () => {
    const u = await user();
    await enrollTotp(u.id);
    const actor = await actorFromUser(u.id);
    await expect(regenerateRecoveryCodes(actor)).rejects.toThrow(StepUpRequiredError);
  });

  it("issues a fresh batch and invalidates the old one", async () => {
    const u = await user();
    const { recoveryCodes: oldCodes } = await enrollTotp(u.id);
    const steppedUp = await steppedUpActorFromUser(u.id);

    const newCodes = await regenerateRecoveryCodes(steppedUp);
    expect(newCodes).toHaveLength(10);
    expect(newCodes).not.toEqual(oldCodes);

    // The old batch no longer verifies at login.
    const session = await createSession({ userId: u.id, mfaRequired: true });
    await expect(
      completeLoginMfa({ sessionId: session.id, userId: u.id, recoveryCode: oldCodes[0] })
    ).rejects.toThrow(MfaError);
  });
});

describe("completeLoginMfa — the login-time gate", () => {
  it("a valid TOTP code verifies the session (mfaVerifiedAt + stepUpVerifiedAt both set)", async () => {
    const u = await user();
    const { secretBase32 } = await enrollTotp(u.id);
    const session = await createSession({ userId: u.id, mfaRequired: true });

    await completeLoginMfa({ sessionId: session.id, userId: u.id, code: generateTotpCode(secretBase32) });

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.mfaVerifiedAt).not.toBeNull();
    expect(row.stepUpVerifiedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findFirst({ where: { action: "mfa.login_verified", entityId: u.id } });
    expect(audit).not.toBeNull();
  });

  it("an invalid code is rejected and leaves the session unverified", async () => {
    const u = await user();
    await enrollTotp(u.id);
    const session = await createSession({ userId: u.id, mfaRequired: true });

    await expect(completeLoginMfa({ sessionId: session.id, userId: u.id, code: "000000" })).rejects.toThrow(MfaError);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.mfaVerifiedAt).toBeNull();
  });

  it("a recovery code works exactly once", async () => {
    const u = await user();
    const { recoveryCodes } = await enrollTotp(u.id);
    const code = recoveryCodes[0];

    const sessionA = await createSession({ userId: u.id, mfaRequired: true });
    await completeLoginMfa({ sessionId: sessionA.id, userId: u.id, recoveryCode: code });
    const rowA = await prisma.session.findUniqueOrThrow({ where: { id: sessionA.id } });
    expect(rowA.mfaVerifiedAt).not.toBeNull();

    const sessionB = await createSession({ userId: u.id, mfaRequired: true });
    await expect(
      completeLoginMfa({ sessionId: sessionB.id, userId: u.id, recoveryCode: code })
    ).rejects.toThrow(MfaError);
    const rowB = await prisma.session.findUniqueOrThrow({ where: { id: sessionB.id } });
    expect(rowB.mfaVerifiedAt).toBeNull();
  });

  it("using a recovery code is audited as mfa.recovery_code_used", async () => {
    const u = await user();
    const { recoveryCodes } = await enrollTotp(u.id);
    const session = await createSession({ userId: u.id, mfaRequired: true });
    await completeLoginMfa({ sessionId: session.id, userId: u.id, recoveryCode: recoveryCodes[1] });

    const audit = await prisma.auditEvent.findFirst({ where: { action: "mfa.recovery_code_used", entityId: u.id } });
    expect(audit).not.toBeNull();
  });

  it("rate-limits repeated failures for the same account", async () => {
    const u = await user();
    await enrollTotp(u.id);

    for (let i = 0; i < 8; i++) {
      const session = await createSession({ userId: u.id, mfaRequired: true });
      await expect(
        completeLoginMfa({ sessionId: session.id, userId: u.id, code: "000000" })
      ).rejects.toThrow(MfaError);
    }

    // The 9th attempt is blocked by the rate limiter itself, even with no code supplied.
    const session = await createSession({ userId: u.id, mfaRequired: true });
    await expect(completeLoginMfa({ sessionId: session.id, userId: u.id, code: "000000" })).rejects.toThrow(
      "Too many attempts"
    );
  });
});

describe("resolveSessionAuthz — the actual login-block enforcement (Session 20)", () => {
  it("a pending session (mfaRequired, not yet verified) gets ZERO roles/permissions/isSuperAdmin, not just a UI flag", async () => {
    const u = await user({ roles: ["TEACHER"] });
    const session = await createSession({ userId: u.id, mfaRequired: true });

    const snapshot = await resolveSessionAuthz(session.id, u.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.mfaPending).toBe(true);
    expect(snapshot!.isSuperAdmin).toBe(false);
    expect(snapshot!.roles).toEqual([]);
    expect(snapshot!.permissions).toEqual([]);
    expect(snapshot!.organizationIds).toEqual([]);
  });

  it("clears once completeLoginMfa succeeds — the real roles/permissions appear on the next check", async () => {
    const u = await user({ roles: ["TEACHER"] });
    const { secretBase32 } = await enrollTotp(u.id);
    const session = await createSession({ userId: u.id, mfaRequired: true });

    expect((await resolveSessionAuthz(session.id, u.id))!.mfaPending).toBe(true);

    await completeLoginMfa({ sessionId: session.id, userId: u.id, code: generateTotpCode(secretBase32) });

    const snapshot = await resolveSessionAuthz(session.id, u.id);
    expect(snapshot!.mfaPending).toBe(false);
    expect(snapshot!.roles).toContain("TEACHER");
  });

  it("a session with mfaRequired=false (the pre-Session-20 default) is completely unaffected", async () => {
    const u = await user({ roles: ["TEACHER"] });
    const session = await createSession({ userId: u.id });
    const snapshot = await resolveSessionAuthz(session.id, u.id);
    expect(snapshot!.mfaPending).toBe(false);
    expect(snapshot!.roles).toContain("TEACHER");
  });
});

describe("requireStepUp / verifyStepUp — sensitive-action gate", () => {
  it("requireStepUp throws when the actor carries no sessionId at all", async () => {
    const u = await user();
    const actor = await actorFromUser(u.id);
    await expect(requireStepUp(actor)).rejects.toThrow(StepUpRequiredError);
  });

  it("requireStepUp throws when the session has never stepped up", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    const actor = { ...(await actorFromUser(u.id)), sessionId: session.id };
    await expect(requireStepUp(actor)).rejects.toThrow(StepUpRequiredError);
  });

  it("requireStepUp succeeds once verifyStepUp(password) has run", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    const actor = { ...(await actorFromUser(u.id)), sessionId: session.id };

    await verifyStepUp(actor, { type: "password", password: "Test1234!" });
    await expect(requireStepUp(actor)).resolves.toBeUndefined();
  });

  it("verifyStepUp(password) rejects the wrong password and does NOT mark the session stepped up", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    const actor = { ...(await actorFromUser(u.id)), sessionId: session.id };

    await expect(verifyStepUp(actor, { type: "password", password: "wrong-password" })).rejects.toThrow(
      StepUpRequiredError
    );
    await expect(requireStepUp(actor)).rejects.toThrow(StepUpRequiredError);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "step_up.failed", entityId: u.id } });
    expect(audit).not.toBeNull();
  });

  it("verifyStepUp(totp) accepts a live code and rejects a wrong one", async () => {
    const u = await user();
    const { secretBase32 } = await enrollTotp(u.id);
    const session = await createSession({ userId: u.id });
    const actor = { ...(await actorFromUser(u.id)), sessionId: session.id };

    await expect(verifyStepUp(actor, { type: "totp", code: "000000" })).rejects.toThrow(StepUpRequiredError);
    await verifyStepUp(actor, { type: "totp", code: generateTotpCode(secretBase32) });
    await expect(requireStepUp(actor)).resolves.toBeUndefined();
  });

  it("verifyStepUp(recovery_code) consumes the code (single-use, same as login)", async () => {
    const u = await user();
    const { recoveryCodes } = await enrollTotp(u.id);
    const session = await createSession({ userId: u.id });
    const actor = { ...(await actorFromUser(u.id)), sessionId: session.id };

    await verifyStepUp(actor, { type: "recovery_code", code: recoveryCodes[2] });
    await expect(requireStepUp(actor)).resolves.toBeUndefined();

    // Same code again, fresh session — already used.
    const session2 = await createSession({ userId: u.id });
    const actor2 = { ...(await actorFromUser(u.id)), sessionId: session2.id };
    await expect(verifyStepUp(actor2, { type: "recovery_code", code: recoveryCodes[2] })).rejects.toThrow(
      StepUpRequiredError
    );
  });

  it("a revoked session cannot be stepped up", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const actor = { ...(await actorFromUser(u.id)), sessionId: session.id };

    await expect(verifyStepUp(actor, { type: "password", password: "Test1234!" })).rejects.toThrow();
  });

  it("verifyStepUp(password) succeeding actually hashes/compares — sanity check against test-support's known password", async () => {
    const u = await user();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true } });
    expect(await compare("Test1234!", row.passwordHash!)).toBe(true);
  });
});
