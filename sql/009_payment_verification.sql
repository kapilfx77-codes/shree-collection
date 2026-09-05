-- ============================================================================
-- Shree Collection — Payment Verification Fields (009)
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor.
--
-- BACKGROUND
-- The manual eSewa flow needs a verifiable audit trail: when the admin
-- confirms a payment out of band, we record WHO confirmed it, WHEN, and
-- the source of the verification. Likewise for rejections. Storing these
-- fields on the order row keeps the trail in the same place as the order
-- itself and survives replays of the admin order list.
--
-- 000_full_init.sql already declares these columns for new projects; this
-- script adds them to projects that ran the schema before that change. The
-- ADD COLUMN IF NOT EXISTS form makes it safe to re-run.
--
-- VERIFY IT WORKED
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'orders' AND column_name LIKE 'payment_%'
--    ORDER BY column_name;
-- should return all six payment_* columns.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_verified_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_verified_by        TEXT,
  ADD COLUMN IF NOT EXISTS payment_verification_source TEXT,
  ADD COLUMN IF NOT EXISTS payment_rejected_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_rejection_reason   TEXT;

-- Index that speeds up the admin "eSewa awaiting verification" view.
-- Partial index: only the rows the admin queue cares about are indexed,
-- so the cost on writes is negligible.
CREATE INDEX IF NOT EXISTS idx_orders_esewa_pending
  ON public.orders (created_at DESC)
  WHERE payment_method = 'esewa' AND payment_status = 'pending';
