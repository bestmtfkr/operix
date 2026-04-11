-- Per-invoice tax province override
-- Lets the contractor bill based on where the work is performed
-- (place-of-supply rules for construction services)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tax_province TEXT;
