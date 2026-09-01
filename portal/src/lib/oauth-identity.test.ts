import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resolveGoogleSignIn, resolveLinkedInSignIn, listOwnLinkedProviders } from "@/lib/oauth-identity";
import { createLinkIntentValue } from "@/lib/oauth-link-intent";
import { resolveSessionAuthz, revokeSession } from "@/lib/sessions";
import { actorFromUser, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * next/headers's cookies() requires a real Next.js request context, which
 * Vitest doesn't provide — mocked with a plain in-memory Map so
 * oauth-identity.ts's link-intent cookie read/delete can be driven directly
 * from each test (set a value to simulate an authenticated "connect
 * Google" click; assert it's gone afterward, proving single-use).
 */
const mockCookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mockCookieStore.has(name) ? { name, value: mockCookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      mockCookieStore.set(name, value);
    },
    delete: (name: string) => {
      mockCookieStore.delete(name);
    },
  }),
}));

const createdUserIds: string[] = [];
async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

function uniqueEmail(): string {
  return `oauth-test-${randomUUID()}@example.com`;
}

async function cleanupIdentities(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
}

/** Session 40 — keen_african_verifications has two FK columns to users (userId, reviewedBy); clean up by either before cleanupTestUsers() deletes the User rows. */
async function cleanupVerifications(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.keenAfricanVerification.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { reviewedBy: { in: userIds } }] },
  });
}

afterAll(async () => {
  await cleanupIdentities(createdUserIds);
  await cleanupVerifications(createdUserIds);
  await cleanupTestUsers(createdUserIds);
});

beforeEach(() => {
  mockCookieStore.clear();
});

describe("resolveGoogleSignIn — brand-new Google-only account", () => {
  it("creates a User (no password) + a single role + a linked UserIdentity, and signs them in", async () => {
    const email = uniqueEmail();
    const providerAccountId = randomUUID();

    const result = await resolveGoogleSignIn({
      providerAccountId,
      email,
      name: "New Teacher",
      signupRole: "TEACHER",
    });

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    createdUserIds.push(result.userId);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(row.email.toLowerCase()).toBe(email.toLowerCase());
    expect(row.passwordHash).toBeNull();

    const roles = await prisma.userRole.findMany({ where: { userId: result.userId }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(["TEACHER"]);

    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    });
    expect(identity?.userId).toBe(result.userId);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: result.sessionId } });
    expect(session.userId).toBe(result.userId);
  });

  it("marks the account's email verified immediately — Google already proved it, unlike a password registration", async () => {
    const email = uniqueEmail();
    const result = await resolveGoogleSignIn({
      providerAccountId: randomUUID(),
      email,
      name: "Verified Via Google",
      signupRole: "KEEN_AFRICAN",
    });

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    createdUserIds.push(result.userId);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("rejects when no signupRole is supplied (admin/sponsor subdomains have no public signup path)", async () => {
    const result = await resolveGoogleSignIn({
      providerAccountId: randomUUID(),
      email: uniqueEmail(),
      name: "Someone",
    });
    expect(result).toEqual({ outcome: "rejected", reason: "no_self_service_signup" });
  });

  it("rejects when the Google profile has no email", async () => {
    const result = await resolveGoogleSignIn({
      providerAccountId: randomUUID(),
      email: null,
      name: "No Email",
      signupRole: "STUDENT",
    });
    expect(result).toEqual({ outcome: "rejected", reason: "no_email" });
  });
});

describe("resolveGoogleSignIn — returning Google user", () => {
  it("signs in as the same user on a second sign-in with the same providerAccountId, without creating a second account", async () => {
    const email = uniqueEmail();
    const providerAccountId = randomUUID();

    const first = await resolveGoogleSignIn({ providerAccountId, email, name: "Repeat Student", signupRole: "STUDENT" });
    expect(first.outcome).toBe("ok");
    if (first.outcome !== "ok") return;
    createdUserIds.push(first.userId);

    const second = await resolveGoogleSignIn({ providerAccountId, email, name: "Repeat Student", signupRole: "STUDENT" });
    expect(second.outcome).toBe("ok");
    if (second.outcome !== "ok") return;

    expect(second.userId).toBe(first.userId);
    expect(second.sessionId).not.toBe(first.sessionId);

    const identities = await prisma.userIdentity.findMany({ where: { userId: first.userId } });
    expect(identities).toHaveLength(1);
  });
});

describe("resolveGoogleSignIn — existing password account, same email, no prior Google link", () => {
  it("REJECTS instead of silently merging (the documented account-linking rule)", async () => {
    const passwordUser = await user();

    const result = await resolveGoogleSignIn({
      providerAccountId: randomUUID(),
      email: passwordUser.email,
      name: passwordUser.name,
      signupRole: "TEACHER",
    });

    expect(result).toEqual({ outcome: "rejected", reason: "email_exists_unlinked" });

    // Nothing was linked, and no second account was created for the email.
    const identities = await prisma.userIdentity.findMany({ where: { userId: passwordUser.id } });
    expect(identities).toHaveLength(0);
    const matchingUsers = await prisma.user.findMany({ where: { email: passwordUser.email } });
    expect(matchingUsers).toHaveLength(1);
  });
});

describe("resolveGoogleSignIn — self-service linking (already authenticated, connecting Google)", () => {
  it("links Google to the authenticated user's own account when the link-intent cookie is present", async () => {
    const passwordUser = await user();
    mockCookieStore.set("oauth_link_intent", createLinkIntentValue(passwordUser.id));

    const providerAccountId = randomUUID();
    const result = await resolveGoogleSignIn({
      providerAccountId,
      email: "a-different-address@example.com",
      name: passwordUser.name,
    });

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.userId).toBe(passwordUser.id);

    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    });
    expect(identity?.userId).toBe(passwordUser.id);

    const linked = await listOwnLinkedProviders(passwordUser.id);
    expect(linked).toEqual(["google"]);

    // Single-use: the cookie is gone after one resolution.
    expect(mockCookieStore.has("oauth_link_intent")).toBe(false);
  });

  it("rejects (never silently re-points) when the Google account is already linked to a DIFFERENT user", async () => {
    const owner = await user();
    const otherUser = await user();
    const providerAccountId = randomUUID();
    await prisma.userIdentity.create({ data: { userId: owner.id, provider: "google", providerAccountId } });

    mockCookieStore.set("oauth_link_intent", createLinkIntentValue(otherUser.id));

    const result = await resolveGoogleSignIn({
      providerAccountId,
      email: owner.email,
      name: owner.name,
    });

    expect(result).toEqual({ outcome: "rejected", reason: "conflicting_link" });

    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    });
    expect(identity?.userId).toBe(owner.id);
  });
});

describe("resolveGoogleSignIn — suspended account", () => {
  it("rejects sign-in for a linked identity whose account is suspended", async () => {
    const suspended = await user({ status: "suspended" });
    const providerAccountId = randomUUID();
    await prisma.userIdentity.create({ data: { userId: suspended.id, provider: "google", providerAccountId } });

    const result = await resolveGoogleSignIn({
      providerAccountId,
      email: suspended.email,
      name: suspended.name,
    });

    expect(result).toEqual({ outcome: "rejected", reason: "account_suspended" });
  });
});

describe("Session/revocation parity — a Google-originated session behaves exactly like a password one", () => {
  it("is revocable via the same revokeSession()/resolveSessionAuthz() path, with no special-casing", async () => {
    const email = uniqueEmail();
    const result = await resolveGoogleSignIn({
      providerAccountId: randomUUID(),
      email,
      name: "Revocation Check",
      signupRole: "STUDENT",
    });
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    createdUserIds.push(result.userId);

    expect(await resolveSessionAuthz(result.sessionId, result.userId)).not.toBeNull();

    const actor = await actorFromUser(result.userId);
    await revokeSession(result.sessionId, actor);

    expect(await resolveSessionAuthz(result.sessionId, result.userId)).toBeNull();
  });
});

/**
 * Session 40 (Keen Africans — LinkedIn Verification). resolveLinkedInSignIn()
 * deliberately reuses resolveGoogleSignIn()'s exact linking mechanism/rule
 * (cases 1/2/3/5 — see that function's own docstring) but is narrower:
 * LinkedIn is never a signup entrypoint on this platform (no `signupRole`
 * is ever supplied), so case 4 can never fire. These tests cover exactly
 * the behavior that differs from Google, plus the one new side effect —
 * connecting LinkedIn moves verification status to 'linkedin_connected'.
 */
describe("resolveLinkedInSignIn — self-service connect (the only path that ever links LinkedIn)", () => {
  it("links LinkedIn to the authenticated user's own account AND moves verification status to linkedin_connected", async () => {
    const passwordUser = await user({ roles: ["KEEN_AFRICAN"] });
    mockCookieStore.set("oauth_link_intent", createLinkIntentValue(passwordUser.id));

    const providerAccountId = randomUUID();
    const result = await resolveLinkedInSignIn({
      providerAccountId,
      email: "a-different-address@example.com",
      name: "Ada LinkedIn",
      pictureUrl: "https://media.licdn.com/ada.jpg",
    });

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.userId).toBe(passwordUser.id);

    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider: "linkedin", providerAccountId } },
    });
    expect(identity?.userId).toBe(passwordUser.id);

    const linked = await listOwnLinkedProviders(passwordUser.id);
    expect(linked).toEqual(["linkedin"]);

    const verification = await prisma.keenAfricanVerification.findUnique({ where: { userId: passwordUser.id } });
    expect(verification?.status).toBe("linkedin_connected");
    expect(verification?.linkedinName).toBe("Ada LinkedIn");

    // Single-use, same as Google's.
    expect(mockCookieStore.has("oauth_link_intent")).toBe(false);
  });

  it("a repeat sign-in via an already-linked LinkedIn identity is a normal login — it does NOT re-touch verification status", async () => {
    const passwordUser = await user({ roles: ["KEEN_AFRICAN"] });
    mockCookieStore.set("oauth_link_intent", createLinkIntentValue(passwordUser.id));
    const providerAccountId = randomUUID();

    const first = await resolveLinkedInSignIn({
      providerAccountId,
      email: "first@example.com",
      name: "Ada LinkedIn",
      pictureUrl: null,
    });
    expect(first.outcome).toBe("ok");

    // Approve it, so a regression that re-runs connectLinkedIn() on every
    // sign-in would be visible (it would demote 'verified' back to
    // 'linkedin_connected' — see verification.ts's own documented "relink
    // demotes" behavior, which must NOT fire for a plain repeat login).
    const admin = await user({ roles: ["ADMIN"] });
    const { approveVerification } = await import("@/lib/verification");
    await approveVerification(passwordUser.id, await actorFromUser(admin.id));

    const second = await resolveLinkedInSignIn({
      providerAccountId,
      email: "first@example.com",
      name: "Ada LinkedIn",
      pictureUrl: null,
    });
    expect(second.outcome).toBe("ok");
    if (second.outcome !== "ok") return;
    expect(second.userId).toBe(passwordUser.id);

    const verification = await prisma.keenAfricanVerification.findUnique({ where: { userId: passwordUser.id } });
    expect(verification?.status).toBe("verified");
  });

  it("is never a signup entrypoint — no link-intent, no existing identity always rejects, even for a brand-new email", async () => {
    const result = await resolveLinkedInSignIn({
      providerAccountId: randomUUID(),
      email: `linkedin-fresh-${randomUUID()}@example.com`,
      name: "Nobody",
      pictureUrl: null,
    });
    expect(result).toEqual({ outcome: "rejected", reason: "no_self_service_signup" });

    // Confirm no account was created for that email.
    const matching = await prisma.user.findMany({
      where: { email: `linkedin-fresh-${randomUUID()}@example.com` },
    });
    expect(matching).toHaveLength(0);
  });

  it("rejects (never silently re-points) when the LinkedIn account is already linked to a DIFFERENT user", async () => {
    const owner = await user();
    const otherUser = await user();
    const providerAccountId = randomUUID();
    await prisma.userIdentity.create({ data: { userId: owner.id, provider: "linkedin", providerAccountId } });

    mockCookieStore.set("oauth_link_intent", createLinkIntentValue(otherUser.id));

    const result = await resolveLinkedInSignIn({
      providerAccountId,
      email: owner.email,
      name: owner.name,
      pictureUrl: null,
    });

    expect(result).toEqual({ outcome: "rejected", reason: "conflicting_link" });

    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider: "linkedin", providerAccountId } },
    });
    expect(identity?.userId).toBe(owner.id);
  });

  it("rejects sign-in for a linked identity whose account is suspended", async () => {
    const suspended = await user({ status: "suspended" });
    const providerAccountId = randomUUID();
    await prisma.userIdentity.create({ data: { userId: suspended.id, provider: "linkedin", providerAccountId } });

    const result = await resolveLinkedInSignIn({
      providerAccountId,
      email: suspended.email,
      name: suspended.name,
      pictureUrl: null,
    });

    expect(result).toEqual({ outcome: "rejected", reason: "account_suspended" });
  });

  it("Google and LinkedIn identities coexist independently on the same account", async () => {
    const passwordUser = await user();
    await prisma.userIdentity.create({ data: { userId: passwordUser.id, provider: "google", providerAccountId: randomUUID() } });

    mockCookieStore.set("oauth_link_intent", createLinkIntentValue(passwordUser.id));
    const linkedinProviderAccountId = randomUUID();
    const result = await resolveLinkedInSignIn({
      providerAccountId: linkedinProviderAccountId,
      email: "whatever@example.com",
      name: passwordUser.name,
      pictureUrl: null,
    });
    expect(result.outcome).toBe("ok");

    const linked = await listOwnLinkedProviders(passwordUser.id);
    expect(linked.sort()).toEqual(["google", "linkedin"]);
  });
});
