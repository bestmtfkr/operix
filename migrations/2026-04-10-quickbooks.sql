-- QuickBooks Online integration — one-way push
-- Run in Supabase SQL editor — safe to re-run

-- Per-company QBO connection (tokens, realm, settings)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS qbo_tokens JSONB,
  ADD COLUMN IF NOT EXISTS qbo_settings JSONB DEFAULT '{}'::jsonb;

-- Link Operix client → QBO Customer
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_sync_token TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_qbo_customer ON clients(company_id, qbo_customer_id);

-- Link Operix invoice → QBO Invoice + sync state
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_sync_token TEXT,
  ADD COLUMN IF NOT EXISTS qbo_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_qbo_invoice ON invoices(company_id, qbo_invoice_id);

-- qbo_settings JSONB shape (for reference, no enforcement):
-- {
--   "realm_id": "9341...",                  -- QBO company ID
--   "environment": "sandbox" | "production",
--   "tax_code_id": "5",                     -- mapped QBO TaxCode for default invoices
--   "tax_code_label": "GST/QST QC",
--   "default_item_id": "1",                 -- fallback Item for line items without explicit mapping
--   "auto_send": false,                     -- whether to call sendable=true on push
--   "last_customer_sync_at": "2026-04-10T..."
-- }
