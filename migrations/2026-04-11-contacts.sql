-- ============================================================
-- Phase 4.1: Contacts — split clients (billable entity) from
-- contacts (individual people). Plus managed_by_client_id so
-- property management companies can be modeled cleanly.
-- ============================================================

-- 1. managed_by_client_id on clients — lets a building point to
--    its property management company as another client row
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS managed_by_client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_managed_by
  ON clients(managed_by_client_id)
  WHERE managed_by_client_id IS NOT NULL;

-- 2. contacts table — individual people who work for / represent a client
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,                         -- 'Property Manager', 'Accounting', 'Super', etc
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  receives_invoices BOOLEAN NOT NULL DEFAULT false,
  -- Optional: contact works for a different company than they represent.
  -- e.g. Chantal at Gestior (employer) represents SDC Symphonia (client).
  -- employer_client_id points to Gestior, client_id points to SDC Symphonia.
  employer_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No UNIQUE on (company_id, email) — same person can contact multiple clients
CREATE INDEX IF NOT EXISTS idx_contacts_client
  ON contacts(client_id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company_email
  ON contacts(company_id, lower(email))
  WHERE email IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_employer
  ON contacts(employer_client_id)
  WHERE employer_client_id IS NOT NULL;

-- Ensure only one is_primary per client — partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_one_primary_per_client
  ON contacts(client_id)
  WHERE is_primary = true AND archived_at IS NULL;

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION contacts_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_touch ON contacts;
CREATE TRIGGER trg_contacts_touch
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_touch_updated_at();

-- 4. RLS — company members can read + write their own company's contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'contacts_select_company') THEN
    CREATE POLICY "contacts_select_company" ON contacts
      FOR SELECT USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'contacts_insert_company') THEN
    CREATE POLICY "contacts_insert_company" ON contacts
      FOR INSERT WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'contacts_update_company') THEN
    CREATE POLICY "contacts_update_company" ON contacts
      FOR UPDATE USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'contacts_delete_company') THEN
    CREATE POLICY "contacts_delete_company" ON contacts
      FOR DELETE USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

-- 5. Optional FK from jobs → contacts (which person on the client is the job contact)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_contact ON jobs(contact_id) WHERE contact_id IS NOT NULL;

-- 6. Optional FK from inbox_emails → contacts (who the sender is as a known contact)
ALTER TABLE inbox_emails
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_emails_contact
  ON inbox_emails(contact_id) WHERE contact_id IS NOT NULL;

-- 7. BACKFILL — every existing client with contact info becomes a primary contact
--    Safe + idempotent: only creates a contact if the client has NO contacts yet
INSERT INTO contacts (company_id, client_id, name, email, phone, is_primary)
SELECT
  c.company_id,
  c.id,
  COALESCE(NULLIF(trim(c.contact_name), ''), c.name),
  NULLIF(trim(c.contact_email), ''),
  NULLIF(trim(c.contact_phone), ''),
  true
FROM clients c
WHERE (c.contact_name IS NOT NULL OR c.contact_email IS NOT NULL OR c.contact_phone IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM contacts ct WHERE ct.client_id = c.id
  );

-- 8. Enable realtime on contacts for future live updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;
END $$;
