import { Prisma } from "@prisma/client";
import { withRls } from "@/lib/rls";
import type { AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx } from "@/lib/courses";
import { uploadAsset, deleteAssetIfOrphanedAsContentOwner } from "@/lib/assets";
import { getStorageDriver } from "@/lib/storage";

/**
 * Public Profile & Account Identity (Session 36). Profile is a separate
 * table from User — see schema.prisma's User.profile field comment and the
 * keen_africans_profiles_core migration's header for the full reasoning
 * (in short: "users" deliberately has no anonymous SELECT branch, and
 * Profile holds only public-safe columns so its SELECT policy can be fully
 * open, with no elevated/system RLS context ever needed).
 *
 * Every mutation here is self-only: there is no ownership permission key
 * to check (unlike articles.write) because there is nothing to check
 * beyond "is this your own row" — see profiles_write/update's RLS policies.
 */

export class ProfileNotFoundError extends Error {
  constructor(message = "Profile not found") {
    super(message);
    this.name = "ProfileNotFoundError";
  }
}

export class UsernameTakenError extends Error {
  constructor(message = "That username is already taken") {
    super(message);
    this.name = "UsernameTakenError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// --- Countries (curated, not exhaustive — African countries first, since
// this is Keen Africa, plus a general "Other" catch-all so no legitimate
// diaspora/international Keen African is blocked from registering). Shared
// by the registration form and the complete-your-profile form so both stay
// in sync with exactly one list. ---------------------------------------
export const COUNTRIES: readonly string[] = [
  "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi",
  "Cabo Verde", "Cameroon", "Central African Republic", "Chad", "Comoros",
  "Congo (Republic of the)", "Congo (Democratic Republic of the)",
  "Cote d'Ivoire", "Djibouti", "Egypt", "Equatorial Guinea", "Eritrea",
  "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea",
  "Guinea-Bissau", "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar",
  "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique",
  "Namibia", "Niger", "Nigeria", "Rwanda", "Sao Tome and Principe",
  "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa",
  "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda",
  "Zambia", "Zimbabwe",
  "Other",
];

// --- Slugs / usernames ---------------------------------------------------

const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

function slugifyUsername(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "keen-african";
}

async function uniqueUsername(name: string): Promise<string> {
  const base = slugifyUsername(name);
  let candidate = base.length >= 3 ? base : `${base}-user`;
  let suffix = 1;
  // Same bounded-probe shape as articles.ts's uniqueSlug() — profile
  // creation happens at most once per user (ensureProfile is idempotent),
  // so this can never be driven into a long scan.
  while (true) {
    const existing = await withRls({}, (tx) => tx.profile.findUnique({ where: { username: candidate }, select: { id: true } }));
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

function normalizeUsernameInput(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 30);
}

function normalizeInterests(interests: string[] | undefined): string[] {
  return Array.from(
    new Set((interests ?? []).map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 40)))
  ).slice(0, 8);
}

const URL_RE = /^https?:\/\/[^\s]{1,290}$/i;

function normalizeUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (!URL_RE.test(trimmed)) throw new Error("Links must be a valid http:// or https:// URL");
  return trimmed;
}

// --- Create (lazy, idempotent) -------------------------------------------

export interface EnsureProfileInput {
  /** The account's registered name — seeds displayName/username at creation only, never touched again. */
  name: string;
  /** Only ever provided by the registration flow (the one signup-time field) — see sessions/36's "keep registration minimal." */
  country?: string;
}

/**
 * Get-or-create — safe to call on every request (the keenafricans protected
 * layout does exactly that, so a Google-sign-in account — which never runs
 * the register Server Action — still gets a profile on first visit). Never
 * overwrites an existing row; country is therefore only ever set on the
 * FIRST call that creates the row (the registration flow's own call,
 * which runs before the layout's own idempotent call ever does).
 */
export async function ensureProfile(actor: AuthzActor, input: EnsureProfileInput) {
  const existing = await withRls(actorRlsCtx(actor), (tx) => tx.profile.findUnique({ where: { userId: actor.id } }));
  if (existing) return existing;

  const username = await uniqueUsername(input.name);
  const displayName = input.name.trim() || "Keen African";

  try {
    return await withRls(actorRlsCtx(actor), (tx) =>
      tx.profile.create({
        data: {
          userId: actor.id,
          username,
          displayName,
          country: input.country?.trim() || null,
        },
      })
    );
  } catch (err) {
    // Idempotency race: two concurrent requests both saw "no profile yet."
    // The loser's INSERT fails the unique(user_id) constraint — just return
    // the winner's row rather than surfacing an error for what is, from the
    // caller's point of view, a successful get-or-create.
    if (isUniqueViolation(err)) {
      const row = await withRls(actorRlsCtx(actor), (tx) => tx.profile.findUnique({ where: { userId: actor.id } }));
      if (row) return row;
    }
    throw err;
  }
}

// --- Reads (self) ---------------------------------------------------------

export async function getMyProfile(actor: AuthzActor) {
  const profile = await withRls(actorRlsCtx(actor), (tx) => tx.profile.findUnique({ where: { userId: actor.id } }));
  if (!profile) throw new ProfileNotFoundError();
  return profile;
}

/**
 * The author-display-name resolver src/lib/articles.ts's createArticle()
 * calls at creation time to populate the authorName snapshot column.
 * Prefers the actor's own Profile.displayName (always public, never needs
 * elevation); falls back to a self-scoped read of users.name for the rare
 * case an actor has no profile row yet (defensive only — ensureProfile()
 * runs on every keenafricans protected page load before this could ever be
 * reached in practice). The self-read needs no elevation either: users_select
 * already has a "users.id = app.user_id" branch for any authenticated actor
 * reading their own row.
 */
export async function resolveAuthorName(actor: AuthzActor): Promise<string> {
  const profile = await withRls(actorRlsCtx(actor), (tx) =>
    tx.profile.findUnique({ where: { userId: actor.id }, select: { displayName: true } })
  );
  if (profile) return profile.displayName;

  const user = await withRls(actorRlsCtx(actor), (tx) => tx.user.findUnique({ where: { id: actor.id }, select: { name: true } }));
  return user?.name?.trim() || "Keen African";
}

// --- Update (self only) ---------------------------------------------------

export interface UpdateProfileInput {
  username?: string;
  displayName?: string;
  bio?: string;
  country?: string;
  profession?: string;
  interests?: string[];
  linkedinUrl?: string;
  githubUrl?: string;
  websiteUrl?: string;
  xUrl?: string;
}

export async function updateProfile(actor: AuthzActor, input: UpdateProfileInput) {
  await getMyProfile(actor); // throws ProfileNotFoundError if none exists yet

  let username: string | undefined;
  if (input.username !== undefined) {
    username = normalizeUsernameInput(input.username);
    if (!USERNAME_RE.test(username)) {
      throw new Error("Username must be 3-30 characters: lowercase letters, numbers, and hyphens only");
    }
  }

  const linkedinUrl = input.linkedinUrl !== undefined ? normalizeUrl(input.linkedinUrl) : undefined;
  const githubUrl = input.githubUrl !== undefined ? normalizeUrl(input.githubUrl) : undefined;
  const websiteUrl = input.websiteUrl !== undefined ? normalizeUrl(input.websiteUrl) : undefined;
  const xUrl = input.xUrl !== undefined ? normalizeUrl(input.xUrl) : undefined;

  try {
    return await withRls(actorRlsCtx(actor), (tx) =>
      tx.profile.update({
        where: { userId: actor.id },
        data: {
          ...(username !== undefined ? { username } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName.trim().slice(0, 80) || "Keen African" } : {}),
          ...(input.bio !== undefined ? { bio: input.bio.trim().slice(0, 1000) || null } : {}),
          ...(input.country !== undefined ? { country: input.country.trim().slice(0, 100) || null } : {}),
          ...(input.profession !== undefined ? { profession: input.profession.trim().slice(0, 100) || null } : {}),
          ...(input.interests !== undefined ? { interests: normalizeInterests(input.interests) } : {}),
          ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
          ...(githubUrl !== undefined ? { githubUrl } : {}),
          ...(websiteUrl !== undefined ? { websiteUrl } : {}),
          ...(xUrl !== undefined ? { xUrl } : {}),
        },
      })
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new UsernameTakenError();
    throw err;
  }
}

// --- Avatar (Asset service reuse) -----------------------------------------

export interface SetAvatarInput {
  originalFilename: string;
  declaredMimeType: string;
  buffer: Buffer;
}

export async function setAvatar(actor: AuthzActor, input: SetAvatarInput) {
  const profile = await getMyProfile(actor);

  const asset = await uploadAsset(
    { originalFilename: input.originalFilename, declaredMimeType: input.declaredMimeType, buffer: input.buffer },
    actor
  );

  try {
    await withRls(actorRlsCtx(actor), async (tx) => {
      // A profile carries at most one avatar — detach the previous one (if
      // any) in the same transaction as attaching the new one, same shape
      // as articles.ts's setCoverImage().
      await tx.assetAttachment.deleteMany({ where: { entityType: "avatar", entityId: profile.id } });
      await tx.assetAttachment.create({
        data: { assetId: asset.id, entityType: "avatar", entityId: profile.id, attachedBy: actor.id },
      });
      await tx.profile.update({ where: { id: profile.id }, data: { avatarAssetId: asset.id } });
    });
  } catch (err) {
    await deleteAssetIfOrphanedAsContentOwner(asset.id, actor).catch(() => {});
    throw err;
  }

  if (profile.avatarAssetId) {
    await deleteAssetIfOrphanedAsContentOwner(profile.avatarAssetId, actor).catch(() => {});
  }

  await recordAuditEvent({ actorId: actor.id, action: "profile.avatar_set", entityType: "Profile", entityId: profile.id, metadata: { assetId: asset.id } });

  return asset;
}

export async function removeAvatar(actor: AuthzActor) {
  const profile = await getMyProfile(actor);
  if (!profile.avatarAssetId) return;

  await withRls(actorRlsCtx(actor), async (tx) => {
    await tx.assetAttachment.deleteMany({ where: { entityType: "avatar", entityId: profile.id } });
    await tx.profile.update({ where: { id: profile.id }, data: { avatarAssetId: null } });
  });

  await deleteAssetIfOrphanedAsContentOwner(profile.avatarAssetId, actor).catch(() => {});
  await recordAuditEvent({ actorId: actor.id, action: "profile.avatar_removed", entityType: "Profile", entityId: profile.id });
}

/**
 * Account & Security (Session 37) — the Profile half of self-service
 * account deletion. Called by src/lib/articles.ts's
 * deleteOwnKeenAfricanAccount() BEFORE that function's call to
 * src/lib/users.ts's anonymizeOwnAccount() (the actual point of no return —
 * see that function's own comment for why the reversible, self-scoped
 * steps run first). Scrubs every public-facing field except `username`:
 * the profile URL (`/u/<username>`) stays live and resolvable rather than
 * 404ing — every article byline link pointing at it keeps working, now
 * showing the anonymized name instead. A no-op if the account somehow has
 * no profile row yet (defensive only — ensureProfile() runs on every
 * keenafricans protected page load, same fallback shape resolveAuthorName()
 * above already uses).
 */
export async function anonymizeOwnProfile(actor: AuthzActor, anonymizedName: string): Promise<void> {
  const profile = await withRls(actorRlsCtx(actor), (tx) => tx.profile.findUnique({ where: { userId: actor.id } }));
  if (!profile) return;

  if (profile.avatarAssetId) {
    await removeAvatar(actor);
  }

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.profile.update({
      where: { id: profile.id },
      data: {
        displayName: anonymizedName,
        bio: null,
        country: null,
        profession: null,
        interests: [],
        linkedinUrl: null,
        githubUrl: null,
        websiteUrl: null,
        xUrl: null,
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "profile.anonymized", entityType: "Profile", entityId: profile.id });
}

/**
 * Batch username lookup by user id, for linking an article byline
 * (authorName is a snapshot with no username on it — see
 * schema.prisma's Article.authorName comment) to its live public profile
 * URL. Public/anonymous (withRls({})) — safe and needs no elevated context
 * at all, unlike the users-table lookup this replaces, because
 * profiles_select is unconditionally open. A user with no profile row
 * simply has no entry in the returned map; callers render the byline as
 * plain text (no link) in that case.
 */
export async function getUsernamesByUserIds(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const profiles = await withRls({}, (tx) =>
    tx.profile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, username: true } })
  );
  return new Map(profiles.map((p) => [p.userId, p.username]));
}

// --- Public reads (no actor — anonymous, always allowed) ------------------

/**
 * Public profile page — keenafricans.<root>/u/<username>. No login
 * required, same "publicly readable" shape as getPublicArticleBySlug(),
 * but with no draft/published gate at all: a Profile is always fully
 * public once it exists (profiles_select is unconditionally open). Lists
 * only the author's PUBLISHED articles — same rule Session 34 established
 * for the article listing/reading pages, applied here too (this session's
 * own explicit rule).
 */
export async function getPublicProfileByUsername(username: string) {
  const profile = await withRls({}, (tx) => tx.profile.findUnique({ where: { username: username.trim().toLowerCase() } }));
  if (!profile) return null;

  const articles = await withRls({}, (tx) =>
    tx.article.findMany({
      where: { authorId: profile.userId, status: "published" },
      orderBy: { publishedAt: "desc" },
    })
  );

  return { profile, articles };
}

/**
 * Public, unauthenticated avatar bytes — mirrors
 * articles.ts's getPublicArticleCoverBytes() but with no published-only
 * restriction, since a profile carries no draft state to protect (see this
 * module's header). Returns null for anything else (unattached, unknown
 * id), so the caller can 404 uniformly.
 */
export async function getPublicAvatarBytes(assetId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const attachment = await withRls({}, (tx) =>
    tx.assetAttachment.findFirst({ where: { assetId, entityType: "avatar" }, select: { id: true } })
  );
  if (!attachment) return null;

  const asset = await withRls({}, (tx) => tx.asset.findUnique({ where: { id: assetId } }));
  if (!asset || asset.status === "deleted") return null;

  const buffer = await getStorageDriver().get(asset.storageKey);
  return { buffer, mimeType: asset.mimeType };
}
