-- ============================================================
-- OPERIX — Full Production Schema
-- Run this in Supabase SQL Editor
-- WARNING: This drops ALL existing tables and starts fresh
-- ============================================================

-- Drop old tables (order matters for foreign keys)
DROP TABLE IF EXISTS inbox_emails CASCADE;
DROP TABLE IF EXISTS pipeline_items CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS job_workers CASCADE;
DROP TABLE IF EXISTS job_activity CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
DROP TABLE IF EXISTS workers CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- ============================================================
-- 1. COMPANIES
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  industry TEXT DEFAULT 'facility_management',
  country TEXT NOT NULL DEFAULT 'CA',
  province_state TEXT,
  city TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_zip TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_url TEXT,
  plan TEXT NOT NULL DEFAULT 'trial',
  -- Settings stored as JSONB (no separate table)
  settings JSONB NOT NULL DEFAULT '{
    "tax_mode": "hst",
    "tax_label_1": "HST",
    "tax_rate_1": 0.13,
    "tax_label_2": null,
    "tax_rate_2": null,
    "tax_registration_number": null,
    "invoice_prefix": "INV",
    "invoice_next_number": 1001,
    "quote_prefix": "QT",
    "quote_next_number": 1001,
    "default_payment_terms_days": 30,
    "currency": "CAD",
    "overtime_threshold_hours": 8.0,
    "overtime_multiplier": 1.5
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- ============================================================
-- 2. PROFILES (linked to Supabase Auth)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'office', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. CLIENTS
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'commercial'
    CHECK (type IN ('commercial', 'residential', 'insurance', 'government')),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_city TEXT,
  billing_province_state TEXT,
  billing_postal_zip TEXT,
  billing_country TEXT DEFAULT 'CA',
  default_payment_terms_days INTEGER,
  tax_exempt BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- ============================================================
-- 4. WORKERS
-- ============================================================
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'technician'
    CHECK (role IN ('technician', 'lead', 'foreman', 'apprentice', 'subcontractor')),
  hourly_rate NUMERIC(8,2),
  employment_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (employment_type IN ('employee', 'subcontractor')),
  certifications TEXT[] DEFAULT '{}',
  hire_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'on_leave', 'terminated')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- ============================================================
-- 5. JOBS (central entity — IS the pipeline)
-- ============================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_number TEXT NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  -- Inline site address (no separate sites table for beta)
  site_address TEXT,
  site_city TEXT,
  site_province_state TEXT,
  site_postal_zip TEXT,
  site_access_notes TEXT,
  -- Job details
  name TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'quoted', 'active', 'completed', 'invoiced', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('emergency', 'urgent', 'normal', 'low')),
  job_type TEXT,
  source TEXT,
  estimated_value NUMERIC(12,2),
  -- Insurance fields (restoration)
  insurance_claim_number TEXT,
  insurance_company TEXT,
  insurance_adjuster TEXT,
  insurance_deductible NUMERIC(10,2),
  -- Scheduling
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  -- Flags
  is_on_hold BOOLEAN NOT NULL DEFAULT false,
  hold_reason TEXT,
  is_lost BOOLEAN NOT NULL DEFAULT false,
  lost_reason TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule JSONB,
  parent_job_id UUID REFERENCES jobs(id),
  -- Tracking
  stage_changed_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  -- Unique job number per company
  UNIQUE(company_id, job_number)
);

-- ============================================================
-- 6. JOB_WORKERS (many-to-many assignment)
-- ============================================================
CREATE TABLE job_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  role_on_job TEXT NOT NULL DEFAULT 'crew'
    CHECK (role_on_job IN ('lead', 'crew', 'subcontractor')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

-- ============================================================
-- 7. TASKS
-- ============================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES workers(id),
  created_by UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  due_date DATE,
  due_time TIME,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. TIME ENTRIES
-- ============================================================
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  total_hours NUMERIC(5,2),
  overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  hourly_rate_at_time NUMERIC(8,2),
  description TEXT,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. QUOTES
-- ============================================================
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  job_id UUID REFERENCES jobs(id),
  quote_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'approved', 'declined', 'expired')),
  version INTEGER NOT NULL DEFAULT 1,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  currency TEXT NOT NULL DEFAULT 'CAD',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax1_label TEXT,
  tax1_rate NUMERIC(5,4),
  tax1_amount NUMERIC(12,2) DEFAULT 0,
  tax2_label TEXT,
  tax2_rate NUMERIC(5,4),
  tax2_amount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  internal_notes TEXT,
  sent_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, quote_number)
);

-- ============================================================
-- 10. INVOICES
-- ============================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  job_id UUID REFERENCES jobs(id),
  quote_id UUID REFERENCES quotes(id),
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax1_label TEXT,
  tax1_rate NUMERIC(5,4),
  tax1_amount NUMERIC(12,2) DEFAULT 0,
  tax2_label TEXT,
  tax2_rate NUMERIC(5,4),
  tax2_amount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  internal_notes TEXT,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE(company_id, invoice_number)
);

-- ============================================================
-- 11. INVOICE LINES (shared for quotes + invoices)
-- ============================================================
CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Polymorphic parent: either a quote or an invoice
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  line_type TEXT NOT NULL DEFAULT 'service'
    CHECK (line_type IN ('service', 'material', 'equipment', 'expense', 'discount')),
  description TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'each'
    CHECK (unit IN ('each', 'hour', 'sqft', 'lnft', 'day', 'unit')),
  unit_price NUMERIC(10,2) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  taxable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Must belong to either an invoice or a quote
  CHECK (invoice_id IS NOT NULL OR quote_id IS NOT NULL)
);

-- ============================================================
-- 12. EQUIPMENT
-- ============================================================
CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  serial_number TEXT,
  daily_rate NUMERIC(8,2),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'deployed', 'maintenance', 'retired')),
  current_job_id UUID REFERENCES jobs(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- ============================================================
-- 13. JOB ACTIVITY (notes, photos, status changes, docs)
-- ============================================================
CREATE TABLE job_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id),
  worker_id UUID REFERENCES workers(id),
  type TEXT NOT NULL DEFAULT 'note'
    CHECK (type IN ('note', 'photo', 'document', 'status_change', 'call', 'email_sent', 'email_received')),
  content TEXT,
  file_url TEXT,
  file_name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- INDEXES (for fast queries)
-- ============================================================
CREATE INDEX idx_clients_company ON clients(company_id) WHERE archived_at IS NULL;
CREATE INDEX idx_workers_company ON workers(company_id) WHERE archived_at IS NULL;
CREATE INDEX idx_jobs_company_stage ON jobs(company_id, stage) WHERE archived_at IS NULL;
CREATE INDEX idx_jobs_client ON jobs(company_id, client_id);
CREATE INDEX idx_jobs_scheduled ON jobs(company_id, scheduled_start);
CREATE INDEX idx_job_workers_job ON job_workers(job_id) WHERE removed_at IS NULL;
CREATE INDEX idx_job_workers_worker ON job_workers(worker_id) WHERE removed_at IS NULL;
CREATE INDEX idx_tasks_company ON tasks(company_id, status);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_job ON tasks(job_id);
CREATE INDEX idx_time_entries_job ON time_entries(company_id, job_id);
CREATE INDEX idx_time_entries_worker ON time_entries(company_id, worker_id, date);
CREATE INDEX idx_invoices_company ON invoices(company_id, status);
CREATE INDEX idx_invoices_client ON invoices(company_id, client_id);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_quote ON invoice_lines(quote_id);
CREATE INDEX idx_quotes_company ON quotes(company_id, status);
CREATE INDEX idx_quotes_client ON quotes(company_id, client_id);
CREATE INDEX idx_equipment_company ON equipment(company_id) WHERE archived_at IS NULL;
CREATE INDEX idx_equipment_job ON equipment(current_job_id);
CREATE INDEX idx_job_activity_job ON job_activity(job_id);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_activity ENABLE ROW LEVEL SECURITY;

-- Company: users can see their own company
CREATE POLICY "users_own_company" ON companies
  FOR ALL USING (id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

-- All other tables: users can access their company's data
CREATE POLICY "company_isolation" ON profiles
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON clients
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON workers
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON jobs
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON job_workers
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON tasks
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON time_entries
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON quotes
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON invoices
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON invoice_lines
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON equipment
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "company_isolation" ON job_activity
  FOR ALL USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));


-- ============================================================
-- HELPER FUNCTION: Auto-generate job numbers
-- ============================================================
CREATE OR REPLACE FUNCTION generate_job_number(p_company_id UUID)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(job_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
  INTO next_num
  FROM jobs
  WHERE company_id = p_company_id;

  RETURN 'JOB-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER FUNCTION: Auto-generate invoice numbers
-- ============================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(p_company_id UUID)
RETURNS TEXT AS $$
DECLARE
  prefix TEXT;
  next_num INTEGER;
BEGIN
  SELECT
    COALESCE(settings->>'invoice_prefix', 'INV'),
    COALESCE((settings->>'invoice_next_number')::INTEGER, 1001)
  INTO prefix, next_num
  FROM companies
  WHERE id = p_company_id;

  -- Increment the next number
  UPDATE companies
  SET settings = jsonb_set(settings, '{invoice_next_number}', to_jsonb(next_num + 1))
  WHERE id = p_company_id;

  RETURN prefix || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER FUNCTION: Auto-generate quote numbers
-- ============================================================
CREATE OR REPLACE FUNCTION generate_quote_number(p_company_id UUID)
RETURNS TEXT AS $$
DECLARE
  prefix TEXT;
  next_num INTEGER;
BEGIN
  SELECT
    COALESCE(settings->>'quote_prefix', 'QT'),
    COALESCE((settings->>'quote_next_number')::INTEGER, 1001)
  INTO prefix, next_num
  FROM companies
  WHERE id = p_company_id;

  UPDATE companies
  SET settings = jsonb_set(settings, '{quote_next_number}', to_jsonb(next_num + 1))
  WHERE id = p_company_id;

  RETURN prefix || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
