-- Session 42 (Follow & Author Reputation Display). The "Top Contributor" /
-- "Community Mentor" editorial label — see schema.prisma's ProfileBadge/
-- Profile.editorialBadge comments for the full design (why this is a
-- separate concept from both `featured` and verification).
--
-- No RLS change needed: src/lib/profiles.ts's setProfileBadge() writes
-- through the SAME profiles_update articles.manage branch Session 40's own
-- migration already added for `featured` (see that migration's
-- "profiles_update amendment" comment) — this column needs no policy of
-- its own.
CREATE TYPE "ProfileBadge" AS ENUM ('top_contributor', 'community_mentor');

ALTER TABLE "profiles" ADD COLUMN "editorial_badge" "ProfileBadge";
