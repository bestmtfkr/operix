-- Dedicated archived_at column, separate from status='actioned'
-- Archive = dismissed / done. Actioned = linked to a job. Different semantics.

ALTER TABLE inbox_emails
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index for the default "active inbox" query
CREATE INDEX IF NOT EXISTS idx_inbox_emails_mailbox_active
  ON inbox_emails (mailbox_id, created_at DESC)
  WHERE archived_at IS NULL;
