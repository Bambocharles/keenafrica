-- CreateTable
CREATE TABLE "feature_flags" (
    "key"          text NOT NULL,
    "description"  text NOT NULL,
    "enabled"      boolean NOT NULL DEFAULT false,
    "created_at"   timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- Row-Level Security
-- Flags are non-sensitive (on/off switches for functionality, not secrets):
-- public read, same super_admin-only write pattern as "sponsors".
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;

CREATE POLICY feature_flags_select ON "feature_flags" FOR SELECT USING (true);
CREATE POLICY feature_flags_write ON "feature_flags" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY feature_flags_update ON "feature_flags" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY feature_flags_delete ON "feature_flags" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);
