-- ============================================================================
-- Shree Collection — Payment Rejection Audit Column (010)
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor.
--
-- BACKGROUND
-- Migration 009 added payment_verified_by (for the verify path) but the
-- rejection path needs the same audit field. handleReject in
-- api/admin/orders/reject.js records the admin session subject so a
-- future operator can answer "who rejected this payment, and when?"
-- without relying on application logs.
--
-- This migration is idempotent (ADD COLUMN IF NOT EXISTS) so it is safe
-- to re-run. The column is nullable: only the rejection path writes to
-- it, and only when an admin actually rejects an order.
--
-- VERIFY IT WORKED
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'orders' AND column_name = 'payment_rejected_by';
-- should return exactly one row.
--
-- The orders table already has a CHECK on payment_status that constrains
-- it to 'pending', 'paid', 'failed', 'refunded' — this column does not
-- affect that constraint.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_rejected_by TEXT;
