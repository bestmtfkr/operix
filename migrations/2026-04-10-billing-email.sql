-- Adds billing email support
-- Run this in Supabase SQL editor — safe to re-run (uses IF NOT EXISTS)

-- Per-client default billing email (where invoices get sent in QBO)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Per-job override (varies job to job per Anthony's spec)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Per-invoice resolved value (snapshotted at push time so it doesn't change after)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS billing_email TEXT;
