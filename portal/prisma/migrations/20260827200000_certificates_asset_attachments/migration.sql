-- Session 14 (Certificates) — the follow-up half of the asset_attachments
-- extension started in the previous migration (see that file's header).
--
-- The select branch cascades through certificates' own RLS policy
-- (certificates_core migration) exactly like the sponsor_document branch
-- cascades through project_documents_select — no duplicated visibility
-- logic: whoever can already SELECT a given certificates row (self,
-- course teacher, certificates.manage, super_admin) can see its attachment.
--
-- Only issueCertificateIfEligible() (src/lib/certificates.ts) ever creates
-- the attachment, always under the same systemCertificateCtx used to
-- create the certificates row itself (certificates.manage permission) —
-- so, like sponsor_document, no separate ownership-scoped write branch is
-- needed beyond the top-level certificates.manage bypass this migration
-- adds.

DROP POLICY "asset_attachments_select" ON "asset_attachments";
CREATE POLICY "asset_attachments_select" ON "asset_attachments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND EXISTS (SELECT 1 FROM resources r WHERE r."id" = "asset_attachments"."entity_id")
  )
  OR (
    "asset_attachments"."entity_type" = 'message'
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m."id" = "asset_attachments"."entity_id"
        AND m."conversation_id" IN (SELECT app_current_user_conversation_ids())
    )
  )
  OR (
    "asset_attachments"."entity_type" = 'sponsor_document'
    AND EXISTS (SELECT 1 FROM project_documents pd WHERE pd."id" = "asset_attachments"."entity_id")
  )
  OR (
    "asset_attachments"."entity_type" = 'certificate'
    AND EXISTS (SELECT 1 FROM certificates c WHERE c."id" = "asset_attachments"."entity_id")
  )
);

DROP POLICY "asset_attachments_write" ON "asset_attachments";
CREATE POLICY "asset_attachments_write" ON "asset_attachments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM resources r JOIN lessons l ON l.id = r.lesson_id
      JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE r."id" = "asset_attachments"."entity_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
  OR (
    "asset_attachments"."entity_type" = 'message'
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m."id" = "asset_attachments"."entity_id"
        AND m."sender_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- asset_attachments_delete gains only the top-level certificates.manage
-- bypass (no feature ever removes a certificate's downloadable file today)
-- — the lesson_resource/message branches are otherwise UNCHANGED.
DROP POLICY "asset_attachments_delete" ON "asset_attachments";
CREATE POLICY "asset_attachments_delete" ON "asset_attachments" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM resources r JOIN lessons l ON l.id = r.lesson_id
      JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE r."id" = "asset_attachments"."entity_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
