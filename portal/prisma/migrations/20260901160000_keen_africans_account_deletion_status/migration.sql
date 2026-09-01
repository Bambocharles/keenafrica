-- Session 37 (Keen Africans — Account & Security). Adds the 'deleted'
-- UserStatus value, split into its own migration/transaction — Postgres
-- cannot use a new enum value in the same transaction that adds it (same
-- requirement documented on every prior enum-value addition in this repo,
-- e.g. AssetEntityType's 'avatar'/'article_cover'/'certificate'/...).
ALTER TYPE "UserStatus" ADD VALUE 'deleted';
