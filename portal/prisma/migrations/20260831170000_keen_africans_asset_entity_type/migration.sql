-- Session 34 (Keen Africans). Adds the 'article_cover' AssetEntityType
-- value, split into its own migration/transaction — Postgres cannot use a
-- new enum value in the same transaction that adds it (same requirement
-- documented on the 'message'/'sponsor_document'/'certificate' additions
-- before it).
ALTER TYPE "AssetEntityType" ADD VALUE 'article_cover';
