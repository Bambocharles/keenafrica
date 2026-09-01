-- Session 42 (Follow & Author Reputation Display). See schema.prisma's
-- Follow comment for the full design.
--
-- Note: this migration deliberately does NOT touch
-- "user_identities_user_id_fkey" — `prisma migrate diff`'s output proposed
-- dropping/recreating it (RESTRICT/CASCADE vs. the already-applied
-- NO ACTION/NO ACTION) purely because UserIdentity.user has never declared
-- explicit onDelete/onUpdate in schema.prisma; that's pre-existing drift
-- from Session 19, unrelated to this session's scope, so it was stripped
-- from the generated SQL rather than silently applied here — same call
-- every prior Keen Africans migration touching this diff noise has made.

-- CreateTable
CREATE TABLE "follows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "follower_id" UUID NOT NULL,
    "following_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follows_follower_id_idx" ON "follows"("follower_id");

-- CreateIndex
CREATE INDEX "follows_following_id_idx" ON "follows"("following_id");

-- CreateIndex (also the "can't double-follow" DB-layer guarantee)
CREATE UNIQUE INDEX "follows_follower_id_following_id_key" ON "follows"("follower_id", "following_id");

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The "can't follow yourself" guarantee, layer one of three (see
-- schema.prisma's Follow comment for the other two: follows_insert's own
-- WITH CHECK below, and src/lib/follows.ts's followUser() itself). A CHECK
-- constraint applies even under the isSuperAdmin RLS bypass, which a WITH
-- CHECK policy alone would not — the strongest of the three guarantees.
ALTER TABLE "follows" ADD CONSTRAINT "follows_no_self_follow_check" CHECK ("follower_id" <> "following_id");

-- Row-Level Security
--
-- follows_select: unconditionally open — follower/following counts and
-- the relationship itself are public reputation signals, same "no
-- draft/private state to protect" reasoning profiles_select already
-- established (keen_africans_profiles_core migration). This is what lets
-- src/lib/follows.ts's getFollowerCount()/getFollowingCount()/isFollowing()
-- run anonymously (withRls({})) for the public profile page.
--
-- follows_insert: the follower's own row only (follower_id = app.user_id),
-- WITH CHECK additionally forbidding follower_id = following_id — the
-- actual DB-level enforcement that "can't follow yourself" can never be
-- bypassed by a crafted INSERT even from an authenticated caller, layer
-- two of three (see the CHECK constraint above and followUser()'s own
-- guard for the other two).
--
-- follows_delete: the follower's own row only — unfollowing is always
-- self-service, same shape as profiles_update's self-only branch. No one
-- else (not even the followed user) can remove a follow relationship this
-- way; the followed user's only lever is blocking/reporting via existing
-- mechanisms, out of this session's scope.
--
-- No UPDATE policy — a follow row is never edited in place, only created
-- or deleted (see schema.prisma's Follow comment for why hard delete is
-- the deliberate exception to this codebase's usual append-only
-- convention here).
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows_select" ON "follows" FOR SELECT USING (true);

CREATE POLICY "follows_insert" ON "follows" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    "follower_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "follower_id" <> "following_id"
  )
);

CREATE POLICY "follows_delete" ON "follows" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "follower_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
