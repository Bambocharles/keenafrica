import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { COUNTRIES, ensureProfile, getMyProfile } from "@/lib/profiles";
import { removeAvatarAction, setAvatarAction, updateMyProfileAction } from "./actions";
import { Banner, Button, Card, Field, Input, Select, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  username_taken: "That username is already taken.",
  not_found: "Profile not found — try refreshing the page.",
  unsupported_file_type: "That file type isn't supported for an avatar (PNG, JPEG, WebP, or GIF only).",
  file_too_large: "That image is too large.",
  missing_fields: "Choose an image file first.",
  action_failed: "Something went wrong.",
};

/**
 * "Complete your profile" — the public-facing half of Session 36's split
 * (see this session's own explicit rule: Profile is public, Account is
 * private/Session 37's territory, never mixed into one settings page).
 * Every field here is optional at registration — see
 * src/lib/registration.ts/the keenafricans register Server Action, which
 * only ever collects name/email/password/country.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const { error, saved } = await searchParams;

  // Defensive — the layout already calls ensureProfile() on every protected
  // page load, so this should always be a no-op read in practice.
  await ensureProfile(user, { name: user.name ?? "Keen African" });
  const profile = await getMyProfile(user);

  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
  const publicUrl = `https://keenafricans.${rootDomain}/u/${profile.username}`;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader
        title="Your profile"
        count={0}
        action={
          <a href={publicUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <Button type="button" variant="outline">
              View my profile ↗
            </Button>
          </a>
        }
      />

      {error && <Banner>{ERROR_MESSAGES[error] ?? error}</Banner>}
      {saved === "1" && !error && <Banner variant="success">Profile updated.</Banner>}

      <Card style={{ padding: "20px", display: "grid", gap: "14px", maxWidth: 420 }}>
        <div style={{ fontWeight: 700 }}>Avatar</div>
        {profile.avatarAssetId ? (
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/avatars/${profile.avatarAssetId}`}
              alt=""
              style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }}
            />
            <form action={removeAvatarAction}>
              <Button type="submit" variant="outline">
                Remove
              </Button>
            </form>
          </div>
        ) : (
          <p className={ui.subCell}>No avatar uploaded — your initials show instead.</p>
        )}
        <form action={setAvatarAction} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
          <Button type="submit" variant="outline">
            Upload
          </Button>
        </form>
      </Card>

      <Card style={{ padding: "20px" }}>
        <form action={updateMyProfileAction} style={{ display: "grid", gap: "14px", maxWidth: 480 }}>
          <Field label="Username (used in your public profile URL)">
            <Input name="username" defaultValue={profile.username} required minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" />
          </Field>
          <Field label="Display name">
            <Input name="displayName" defaultValue={profile.displayName} required maxLength={80} />
          </Field>
          <Field label="Bio">
            <textarea name="bio" defaultValue={profile.bio ?? ""} maxLength={1000} rows={4} className={ui.input} />
          </Field>
          <Field label="Country">
            <Select name="country" defaultValue={profile.country ?? ""}>
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Profession">
            <Input name="profession" defaultValue={profile.profession ?? ""} maxLength={100} />
          </Field>
          <Field label="Areas of interest (comma-separated)">
            <Input name="interests" defaultValue={profile.interests.join(", ")} placeholder="Education, Fintech, Climate" />
          </Field>
          <Field label="LinkedIn URL">
            <Input name="linkedinUrl" type="url" defaultValue={profile.linkedinUrl ?? ""} placeholder="https://linkedin.com/in/..." />
          </Field>
          <Field label="GitHub URL">
            <Input name="githubUrl" type="url" defaultValue={profile.githubUrl ?? ""} placeholder="https://github.com/..." />
          </Field>
          <Field label="Website URL">
            <Input name="websiteUrl" type="url" defaultValue={profile.websiteUrl ?? ""} placeholder="https://..." />
          </Field>
          <Field label="X (Twitter) URL">
            <Input name="xUrl" type="url" defaultValue={profile.xUrl ?? ""} placeholder="https://x.com/..." />
          </Field>
          <div>
            <Button type="submit" variant="primary">
              Save profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
