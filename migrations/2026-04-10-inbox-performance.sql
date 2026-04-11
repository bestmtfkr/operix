-- Inbox performance: critical index for paginated email list
-- Without this, every loadEmails page scan touches 30k+ rows.
CREATE INDEX IF NOT EXISTS idx_inbox_emails_company_created
  ON inbox_emails (company_id, created_at DESC);

-- Partial index for unread filter (saves scan when filtering by status='unread')
CREATE INDEX IF NOT EXISTS idx_inbox_emails_company_unread
  ON inbox_emails (company_id, created_at DESC)
  WHERE status = 'unread';

-- Index for the thread-lookup that auto-sync does
CREATE INDEX IF NOT EXISTS idx_inbox_emails_company_thread
  ON inbox_emails (company_id, (metadata->>'thread_id'));
