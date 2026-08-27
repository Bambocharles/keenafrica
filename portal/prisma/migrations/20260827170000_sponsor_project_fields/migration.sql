-- Session 11 (Sponsor) — adds description/start_date/end_date to
-- "projects", per PLATFORM_DATA_MODEL.md's Project contract ("description",
-- "dates"); the Phase-1 scaffold only had name/slug/status. All nullable,
-- no RLS change needed (covered by the existing projects_* policies).

ALTER TABLE "projects" ADD COLUMN     "description" TEXT,
ADD COLUMN     "end_date" TIMESTAMPTZ(6),
ADD COLUMN     "start_date" TIMESTAMPTZ(6);
