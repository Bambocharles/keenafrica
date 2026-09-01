import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  ProfileNotFoundError,
  UsernameTakenError,
  ensureProfile,
  getMemberLabelUserIds,
  getMyProfile,
  getPublicProfileByUsername,
  getUsernamesByUserIds,
  resolveAuthorName,
  setProfileFeatured,
  updateProfile,
} from "@/lib/profiles";
import { createArticle, publishArticle } from "@/lib/articles";
import { actorFromUser, cleanupTestArticles, cleanupTestProfiles, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
  await cleanupTestArticles(createdArticleIds);
  await cleanupTestProfiles(createdUserIds);
  await cleanupTestUsers(createdUserIds);
});

async function keenAfrican(verified = false) {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  if (verified) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  return actorFromUser(user.id);
}

describe("ensureProfile", () => {
  it("creates a profile with an auto-generated username and no other fields required (registration minimalism)", async () => {
    const actor = await keenAfrican();
    const profile = await ensureProfile(actor, { name: "Ada Lovelace" });

    expect(profile.userId).toBe(actor.id);
    expect(profile.username).toMatch(/^ada-lovelace/);
    expect(profile.displayName).toBe("Ada Lovelace");
    // Every optional field is genuinely optional — none required at
    // creation, matching this session's explicit "keep registration
    // minimal" rule.
    expect(profile.bio).toBeNull();
    expect(profile.country).toBeNull();
    expect(profile.profession).toBeNull();
    expect(profile.interests).toEqual([]);
    expect(profile.linkedinUrl).toBeNull();
    expect(profile.avatarAssetId).toBeNull();
  });

  it("is idempotent — calling it again returns the existing row instead of creating a second one", async () => {
    const actor = await keenAfrican();
    const first = await ensureProfile(actor, { name: "Idempotent Test" });
    const second = await ensureProfile(actor, { name: "Different Name Ignored" });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe("Idempotent Test");
  });

  it("sets country only when provided at creation (the one registration-time field)", async () => {
    const actor = await keenAfrican();
    const profile = await ensureProfile(actor, { name: "With Country", country: "Nigeria" });
    expect(profile.country).toBe("Nigeria");
  });

  it("de-duplicates usernames for the same name (uniqueness)", async () => {
    const a = await keenAfrican();
    const b = await keenAfrican();
    const pa = await ensureProfile(a, { name: "Same Name" });
    const pb = await ensureProfile(b, { name: "Same Name" });
    expect(pa.username).not.toBe(pb.username);
  });
});

describe("updateProfile", () => {
  it("lets the owner update their own profile fields", async () => {
    const actor = await keenAfrican();
    await ensureProfile(actor, { name: "Editable Person" });

    const updated = await updateProfile(actor, {
      bio: "I write about African tech.",
      country: "Kenya",
      profession: "Engineer",
      interests: ["Fintech", "Climate", "Fintech"],
      linkedinUrl: "https://linkedin.com/in/example",
    });

    expect(updated.bio).toBe("I write about African tech.");
    expect(updated.country).toBe("Kenya");
    expect(updated.profession).toBe("Engineer");
    expect(updated.interests).toEqual(["Fintech", "Climate"]);
    expect(updated.linkedinUrl).toBe("https://linkedin.com/in/example");
  });

  it("rejects a taken username (uniqueness enforced on update too)", async () => {
    const a = await keenAfrican();
    const b = await keenAfrican();
    const pa = await ensureProfile(a, { name: "Username Holder" });
    await ensureProfile(b, { name: "Other Person" });

    await expect(updateProfile(b, { username: pa.username })).rejects.toThrow(UsernameTakenError);
  });

  it("rejects an invalid username format", async () => {
    const actor = await keenAfrican();
    await ensureProfile(actor, { name: "Format Test" });
    await expect(updateProfile(actor, { username: "no spaces allowed" })).rejects.toThrow();
  });

  it("rejects a non-http(s) link", async () => {
    const actor = await keenAfrican();
    await ensureProfile(actor, { name: "Link Test" });
    await expect(updateProfile(actor, { websiteUrl: "javascript:alert(1)" })).rejects.toThrow();
  });

  it("throws ProfileNotFoundError for an actor with no profile row yet", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(user.id);
    const actor = await actorFromUser(user.id);
    await expect(getMyProfile(actor)).rejects.toThrow(ProfileNotFoundError);
    await expect(updateProfile(actor, { bio: "x" })).rejects.toThrow(ProfileNotFoundError);
  });
});

describe("resolveAuthorName", () => {
  it("prefers the actor's Profile.displayName", async () => {
    const actor = await keenAfrican();
    await ensureProfile(actor, { name: "Original Name" });
    await updateProfile(actor, { displayName: "Pen Name" });
    expect(await resolveAuthorName(actor)).toBe("Pen Name");
  });

  it("falls back to users.name when the actor has no profile row (defensive path)", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(user.id);
    const actor = await actorFromUser(user.id);
    expect(await resolveAuthorName(actor)).toBe("Test User");
  });
});

describe("getPublicProfileByUsername — public read", () => {
  it("returns null for an unknown username", async () => {
    expect(await getPublicProfileByUsername("does-not-exist-xyz")).toBeNull();
  });

  it("lists only the author's PUBLISHED articles — a draft never leaks on the public profile page", async () => {
    const actor = await keenAfrican(true);
    const profile = await ensureProfile(actor, { name: "Draft Leak Test" });

    const draft = await createArticle({ title: "Still drafting" }, actor);
    createdArticleIds.push(draft.id);
    const published = await createArticle({ title: "Already public" }, actor);
    createdArticleIds.push(published.id);
    await publishArticle(published.id, actor);

    const result = await getPublicProfileByUsername(profile.username);
    expect(result).not.toBeNull();
    const ids = result!.articles.map((a) => a.id);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(draft.id);
  });
});

describe("getUsernamesByUserIds", () => {
  it("returns a map keyed by user id, omitting users with no profile", async () => {
    const actor = await keenAfrican();
    const profile = await ensureProfile(actor, { name: "Lookup Test" });
    const noProfileUser = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(noProfileUser.id);

    const map = await getUsernamesByUserIds([actor.id, noProfileUser.id]);
    expect(map.get(actor.id)).toBe(profile.username);
    expect(map.has(noProfileUser.id)).toBe(false);
  });
});

/**
 * Session 40 (Keen Africans — LinkedIn Verification). The "Keen African"
 * public membership label's denormalized source — see profiles.ts's
 * ensureProfile() comment and email-verification.ts's
 * confirmEmailVerification() for the two write sites this covers.
 */
describe("ensureProfile — email-verification sync (Session 40)", () => {
  it("seeds emailVerified=true at creation when the account was already email-verified (the Google-signup ordering)", async () => {
    const actor = await keenAfrican(true);
    const profile = await ensureProfile(actor, { name: "Already Verified" });
    expect(profile.emailVerified).toBe(true);
  });

  it("seeds emailVerified=false at creation for a not-yet-verified account", async () => {
    const actor = await keenAfrican(false);
    const profile = await ensureProfile(actor, { name: "Not Yet Verified" });
    expect(profile.emailVerified).toBe(false);
  });
});

describe("getMemberLabelUserIds", () => {
  it("returns only accounts whose profile has emailVerified=true", async () => {
    const verifiedActor = await keenAfrican(true);
    await ensureProfile(verifiedActor, { name: "Verified Member" });
    const unverifiedActor = await keenAfrican(false);
    await ensureProfile(unverifiedActor, { name: "Unverified Member" });

    const ids = await getMemberLabelUserIds([verifiedActor.id, unverifiedActor.id]);
    expect(ids.has(verifiedActor.id)).toBe(true);
    expect(ids.has(unverifiedActor.id)).toBe(false);
  });
});

describe("setProfileFeatured — articles.manage-gated editorial flag", () => {
  it("a plain Keen African cannot feature anyone, including themselves", async () => {
    const actor = await keenAfrican();
    await ensureProfile(actor, { name: "Cannot Self-Feature" });
    await expect(setProfileFeatured(actor.id, true, actor)).rejects.toThrow(AuthorizationError);
  });

  it("an ADMIN (articles.manage) can feature and unfeature a profile, and it's audited", async () => {
    const actor = await keenAfrican();
    await ensureProfile(actor, { name: "Featured Candidate" });
    const admin = await createTestUser({ roles: ["ADMIN"] });
    createdUserIds.push(admin.id);
    const adminActor = await actorFromUser(admin.id);

    const featured = await setProfileFeatured(actor.id, true, adminActor);
    expect(featured.featured).toBe(true);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "profile.featured", entityId: featured.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();

    const unfeatured = await setProfileFeatured(actor.id, false, adminActor);
    expect(unfeatured.featured).toBe(false);
  });
});
