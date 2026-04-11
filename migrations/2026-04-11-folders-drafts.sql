-- ============================================================
-- Phase 3.2.2: Folders + Drafts
-- - Adds `folder` column to inbox_emails (inbox/sent/drafts/spam/trash)
-- - Creates email_drafts table for Operix-native shared drafts
-- - Backfills sent emails from earlier phases
-- - Enables realtime on email_drafts for team collaboration
-- ============================================================

-- 1. folder column on inbox_emails
ALTER TABLE inbox_emails
  ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'inbox'
  CHECK (folder IN ('inbox', 'sent', 'drafts', 'spam', 'trash'));

-- Composite index for the default "folder view within mailbox" query
CREATE INDEX IF NOT EXISTS idx_inbox_emails_mailbox_folder
  ON inbox_emails(mailbox_id, folder, created_at DESC)
  WHERE archived_at IS NULL;

-- 2. Backfill Sent from earlier phases
--    Any row with status='sent' or metadata.direction='outbound' becomes folder='sent'
UPDATE inbox_emails
   SET folder = 'sent'
 WHERE folder = 'inbox'
   AND (status = 'sent' OR metadata->>'direction' = 'outbound');

-- 3. email_drafts — Operix-native shared drafts
--    Realtime-enabled so two teammates can collaborate live
CREATE TABLE IF NOT EXISTS email_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reply_to_email_id UUID REFERENCES inbox_emails(id) ON DELETE SET NULL,
  thread_id TEXT,
  in_reply_to TEXT,
  "references" TEXT,
  to_addresses TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  body TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_edited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_mailbox
  ON email_drafts(mailbox_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_drafts_company
  ON email_drafts(company_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- 4. updated_at trigger
CREATE OR REPLACE FUNCTION email_drafts_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.last_edited_by = COALESCE(NEW.last_edited_by, auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_drafts_touch ON email_drafts;
CREATE TRIGGER trg_email_drafts_touch
  BEFORE UPDATE ON email_drafts
  FOR EACH ROW
  EXECUTE FUNCTION email_drafts_touch_updated_at();

-- 5. RLS — company members can read/write their company's drafts
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_drafts' AND policyname = 'email_drafts_select_company') THEN
    CREATE POLICY "email_drafts_select_company" ON email_drafts
      FOR SELECT
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_drafts' AND policyname = 'email_drafts_insert_company') THEN
    CREATE POLICY "email_drafts_insert_company" ON email_drafts
      FOR INSERT
      WITH CHECK (
        company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_drafts' AND policyname = 'email_drafts_update_company') THEN
    CREATE POLICY "email_drafts_update_company" ON email_drafts
      FOR UPDATE
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_drafts' AND policyname = 'email_drafts_delete_company') THEN
    CREATE POLICY "email_drafts_delete_company" ON email_drafts
      FOR DELETE
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

-- 6. Enable Supabase realtime on email_drafts for live collaboration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'email_drafts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE email_drafts;
  END IF;
END $$;
