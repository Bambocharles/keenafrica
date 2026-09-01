-- Session 36 (Keen Africans — Profile & Identity). Adds the 'avatar'
-- AssetEntityType value, split into its own migration/transaction —
-- Postgres cannot use a new enum value in the same transaction that adds
-- it (same requirement documented on every prior AssetEntityType addition:
-- 'message', 'sponsor_document', 'certificate', 'article_cover').
ALTER TYPE "AssetEntityType" ADD VALUE 'avatar';
