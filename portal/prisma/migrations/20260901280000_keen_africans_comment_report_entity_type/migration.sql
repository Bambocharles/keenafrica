-- Session 43 (Comments & Reactions). Comments must be reportable through
-- Session 41's existing reporting mechanism, per this session's own brief.
-- Adding an enum value must run in its own transaction, separate from any
-- statement that might reference it (a hard Postgres restriction, same one
-- every prior enum-value addition in this codebase — article_cover,
-- avatar — has hit), which is why this is its own migration rather than
-- folded into the keen_africans_comments migration that follows it.
ALTER TYPE "ReportEntityType" ADD VALUE 'comment';
