-- Session 14 (Certificates) — extends Session 13's Asset/File service for
-- the optional downloadable certificate file, exactly per that session's
-- own documented contract ("add an AssetEntityType value + a matching case
-- in canAccessAssetAttachment() + a matching RLS branch"). Split into its
-- own migration, before the follow-up asset_attachments policy migration,
-- because Postgres cannot use a new enum value in the same transaction
-- that adds it (same reasoning as the 'message'/'sponsor_document'
-- precedents, Sessions 09/11).
ALTER TYPE "AssetEntityType" ADD VALUE 'certificate';
