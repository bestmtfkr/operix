-- ============================================================
-- Phase 3.3: Sender classification (email_senders table)
-- Separate from clients — this is about EMAIL ROUTING rules,
-- not billable entities. A sender can be a lead aggregator,
-- supplier, spam source, etc. without polluting the clients list.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN (
    'client', 'lead_source', 'supplier', 'insurance', 'internal', 'spam', 'other'
  )),
  display_name TEXT,
  linked_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  notes TEXT,
  classified_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, email_address)
);

-- Fast lookup by (company, email) — this is the hot path from the render loop
CREATE INDEX IF NOT EXISTS idx_email_senders_lookup
  ON email_senders(company_id, email_address);

CREATE INDEX IF NOT EXISTS idx_email_senders_type
  ON email_senders(company_id, sender_type);

-- Touch updated_at on modify
CREATE OR REPLACE FUNCTION email_senders_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_senders_touch ON email_senders;
CREATE TRIGGER trg_email_senders_touch
  BEFORE UPDATE ON email_senders
  FOR EACH ROW EXECUTE FUNCTION email_senders_touch_updated_at();

-- RLS — company members can read + write their own company's senders
ALTER TABLE email_senders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_senders' AND policyname = 'email_senders_select_company') THEN
    CREATE POLICY "email_senders_select_company" ON email_senders
      FOR SELECT USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_senders' AND policyname = 'email_senders_insert_company') THEN
    CREATE POLICY "email_senders_insert_company" ON email_senders
      FOR INSERT WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_senders' AND policyname = 'email_senders_update_company') THEN
    CREATE POLICY "email_senders_update_company" ON email_senders
      FOR UPDATE USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_senders' AND policyname = 'email_senders_delete_company') THEN
    CREATE POLICY "email_senders_delete_company" ON email_senders
      FOR DELETE USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- Seed known lead aggregators for every existing company
-- Safe to re-run (uses ON CONFLICT)
-- ============================================================
INSERT INTO email_senders (company_id, email_address, sender_type, display_name, notes)
SELECT
  c.id,
  s.email_address,
  'lead_source',
  s.display_name,
  'Seeded by system — known lead aggregator'
FROM companies c
CROSS JOIN (VALUES
  -- US / global
  ('leads@homeadvisor.com',     'HomeAdvisor'),
  ('noreply@homeadvisor.com',   'HomeAdvisor'),
  ('leads@angi.com',            'Angi'),
  ('noreply@angi.com',          'Angi'),
  ('leads@angieslist.com',      'Angies List (legacy)'),
  ('leads@houzz.com',           'Houzz'),
  ('noreply@houzz.com',         'Houzz'),
  ('leads@yelp.com',            'Yelp'),
  ('noreply@yelp.com',          'Yelp'),
  ('leads@thumbtack.com',       'Thumbtack'),
  ('noreply@thumbtack.com',     'Thumbtack'),
  ('leads@porch.com',           'Porch'),
  ('leads@networx.com',         'Networx'),
  ('noreply@networx.com',       'Networx'),
  ('leads@bark.com',            'Bark'),
  ('leads@nextdoor.com',        'Nextdoor'),
  -- Canada
  ('leads@smartreno.com',         'SmartReno'),
  ('noreply@smartreno.com',       'SmartReno'),
  ('leads@soumissionrenovation.ca','SoumissionRénovation'),
  ('noreply@soumissionrenovation.ca','SoumissionRénovation'),
  ('leads@goquotes.ca',           'GoQuotes'),
  ('leads@renoquotes.com',        'RenoQuotes'),
  ('leads@trustedpros.ca',        'TrustedPros'),
  ('leads@reno-assistance.ca',    'Réno-Assistance'),
  ('leads@servicesparticuliers.ca','Services Particuliers'),
  -- Quebec-specific
  ('leads@jobber.com',            'Jobber (lead routing)')
) AS s(email_address, display_name)
ON CONFLICT (company_id, email_address) DO NOTHING;
