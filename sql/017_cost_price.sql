-- ============================================================================
-- Shree Collection — Add cost_price to products table
-- Migration 017
-- ============================================================================
-- Adds a private acquisition-cost field to the products table.
-- Used as a convenient default when adding new FIFO stock batches.
-- FIFO batch costs are authoritative; product cost_price is a reference only.
--
-- Rules:
--   - NULL: cost is unknown (no prefill on Add Stock)
--   - >= 0: valid acquisition cost
--   - Never returned through public/customer-facing endpoints
-- ============================================================================

BEGIN;

-- Add the column with a check constraint
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2)
  CONSTRAINT products_cost_price_nonneg
  CHECK (cost_price IS NULL OR cost_price >= 0);

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'products' AND column_name = 'cost_price';
-- ============================================================================
