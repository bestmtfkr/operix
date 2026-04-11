-- ============================================================
-- Phase 3: Internal team collaboration layer
-- - email_comments table (thread-scoped team chat on an inbox email)
-- - Thread-cascade assignment helper (assigning one email assigns the thread)
-- ============================================================

-- 1. email_comments table
CREATE TABLE IF NOT EXISTS email_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES inbox_emails(id) ON DELETE CASCADE,
  -- denormalized thread_id for thread-scoped list queries
  thread_id TEXT,
  mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  mentions UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_email_comments_email
  ON email_comments(email_id, created_at);

CREATE INDEX IF NOT EXISTS idx_email_comments_thread
  ON email_comments(thread_id, created_at)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_comments_company_recent
  ON email_comments(company_id, created_at DESC);

-- 3. Row Level Security
ALTER TABLE email_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_comments' AND policyname = 'email_comments_select_company'
  ) THEN
    CREATE POLICY "email_comments_select_company" ON email_comments
      FOR SELECT
      USING (
        company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_comments' AND policyname = 'email_comments_insert_self'
  ) THEN
    CREATE POLICY "email_comments_insert_self" ON email_comments
      FOR INSERT
      WITH CHECK (
        author_id = auth.uid()
        AND company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_comments' AND policyname = 'email_comments_update_own'
  ) THEN
    CREATE POLICY "email_comments_update_own" ON email_comments
      FOR UPDATE
      USING (author_id = auth.uid())
      WITH CHECK (author_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_comments' AND policyname = 'email_comments_delete_own'
  ) THEN
    CREATE POLICY "email_comments_delete_own" ON email_comments
      FOR DELETE
      USING (author_id = auth.uid());
  END IF;
END $$;

-- 4. Auto-populate thread_id + mailbox_id from the parent email on insert
--    (so the frontend only has to pass email_id + body)
CREATE OR REPLACE FUNCTION email_comments_set_context()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.thread_id IS NULL OR NEW.mailbox_id IS NULL THEN
    SELECT
      COALESCE(NEW.thread_id, e.metadata->>'thread_id'),
      COALESCE(NEW.mailbox_id, e.mailbox_id),
      COALESCE(NEW.company_id, e.company_id)
    INTO NEW.thread_id, NEW.mailbox_id, NEW.company_id
    FROM inbox_emails e
    WHERE e.id = NEW.email_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_comments_set_context ON email_comments;
CREATE TRIGGER trg_email_comments_set_context
  BEFORE INSERT ON email_comments
  FOR EACH ROW
  EXECUTE FUNCTION email_comments_set_context();

-- 5. Thread-cascade assignment
--    When inbox_emails.assigned_to is updated on one email, cascade to all
--    emails in the same thread + mailbox. Prevents infinite recursion with
--    a pg_trigger_depth() guard.
CREATE OR REPLACE FUNCTION cascade_thread_assignment()
RETURNS TRIGGER AS $$
DECLARE
  thread_key TEXT;
BEGIN
  -- Only recurse on the outermost call
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- Only act when assigned_to actually changed
  IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;

  thread_key := NEW.metadata->>'thread_id';
  IF thread_key IS NULL OR NEW.mailbox_id IS NULL THEN RETURN NEW; END IF;

  UPDATE inbox_emails
     SET assigned_to = NEW.assigned_to
   WHERE mailbox_id = NEW.mailbox_id
     AND (metadata->>'thread_id') = thread_key
     AND id <> NEW.id
     AND assigned_to IS DISTINCT FROM NEW.assigned_to;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cascade_thread_assignment ON inbox_emails;
CREATE TRIGGER trg_cascade_thread_assignment
  AFTER UPDATE OF assigned_to ON inbox_emails
  FOR EACH ROW
  EXECUTE FUNCTION cascade_thread_assignment();

-- 6. Enable Supabase Realtime on email_comments
--    This adds the table to the supabase_realtime publication so the client
--    can subscribe to INSERT/UPDATE/DELETE for live comment streams.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'email_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE email_comments;
  END IF;
END $$;
