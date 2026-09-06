-- ============================================================================
-- Add batch_allocations column to orders for FIFO cost tracking
-- Migration 016
-- ============================================================================
BEGIN;

-- Stores the FIFO batch consumption allocations as a JSONB array of
-- { batch_id, allocated_qty } objects. Attached at order creation;
-- consumed on payment rejection/cancellation to restore exact batches.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS batch_allocations JSONB;

-- Also store the order's total FIFO cost (actual COGS) as a NUMERIC field
-- so reporting can compute profit without re-running FIFO logic.
-- NULL means "pre-migration order; cost unknown".
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2)
  CHECK (total_cost IS NULL OR total_cost >= 0);

COMMIT;

-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' AND column_name IN ('batch_allocations','total_cost');
