-- Session 45 (Outstanding Fixes & Consolidation). Adds the four
-- review-workflow NotificationType values, split into their own
-- migration/transaction — Postgres cannot use a new enum value in the same
-- transaction that adds it (the same requirement documented on every prior
-- NotificationType addition, e.g. the 'user_followed' migration).
--
-- Session 39 deliberately did not add 'article_approved'/
-- 'article_changes_requested'/'article_rejected' because Session 38's
-- review workflow had not landed yet, and documented the exact contract to
-- add once it did (docs/NOTIFICATIONS.md's "Extension points"). Session 38
-- then landed the workflow but never came back for the notifications, and
-- neither did Sessions 39-44 — so an author who submitted an article for
-- review received no signal about the outcome at all. This closes that.
--
-- 'article_published' is the one value not on Session 39's original list.
-- It covers the two transitions where an article goes live without its
-- author pressing publish at that moment: a reviewer/admin publishing on
-- the author's behalf, and flipDueScheduledArticles() flipping a deferred
-- publish set earlier by scheduleArticle(). A plain self-publish emits
-- nothing — see src/lib/articles.ts.
ALTER TYPE "NotificationType" ADD VALUE 'article_approved';
ALTER TYPE "NotificationType" ADD VALUE 'article_changes_requested';
ALTER TYPE "NotificationType" ADD VALUE 'article_rejected';
ALTER TYPE "NotificationType" ADD VALUE 'article_published';
