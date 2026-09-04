-- ============================================================================
-- Shree Collection — Admin Schema Migration 001
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Project → SQL → New query).
-- It adds the columns the admin dashboard needs and tightens RLS so the
-- anon key can no longer mutate products or orders.
--
-- The admin page never touches the database directly. All writes go through
-- /api/admin/* serverless functions that use the service role key.
-- ============================================================================

-- 1. Add the order management columns.
-- `status` follows the requested workflow: pending → processing → shipped → delivered,
-- with cancelled as a terminal state.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('cod', 'esewa')),
  ADD COLUMN IF NOT EXISTS payment_status text
    CHECK (payment_status IS NULL OR payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 2. Backfill payment_method from the existing `txn` column so old orders still
-- get a meaningful payment_method value. Anything mentioning "esewa" becomes
-- esewa; anything mentioning "cash" or "delivery" becomes cod.
UPDATE public.orders
SET payment_method = CASE
  WHEN txn IS NOT NULL AND lower(txn) LIKE '%esewa%' THEN 'esewa'
  WHEN txn IS NOT NULL AND (lower(txn) LIKE '%cash%' OR lower(txn) LIKE '%delivery%') THEN 'cod'
  ELSE 'cod'
END
WHERE payment_method IS NULL;

UPDATE public.orders
SET payment_status = CASE
  WHEN status = 'pending' AND payment_method = 'esewa' THEN 'pending'
  WHEN status = 'pending' AND payment_method = 'cod' THEN 'pending'
  ELSE 'pending'
END
WHERE payment_status IS NULL;

-- 3. Make sure the updated_at column auto-updates on every change.
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);

-- 4. Tighten RLS so the anon key (browser) can only read public data, never
-- mutate anything. Service role bypasses RLS so /api/admin/* still works.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Public SELECT of arbitrary customer orders must be DENIED.
-- Customer orders contain name, phone, city, address — PII.
-- The storefront never reads orders from the browser; the success page already
-- has the data locally from the cart. `getOrderById` in db.js has zero
-- callers, so removing the SELECT policy is safe.
-- (We deliberately do NOT create an orders_anon_read policy.)

-- Guest checkout DOES need anon INSERT — the storefront's createOrder() uses
-- the anon key directly. Without this policy, enabling RLS above would 401
-- every checkout.
DROP POLICY IF EXISTS orders_anon_insert ON public.orders;
CREATE POLICY orders_anon_insert ON public.orders
  FOR INSERT TO anon WITH CHECK (true);

-- No UPDATE/DELETE policy for anon. Anon cannot mutate or remove orders.

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_anon_read ON public.products;
CREATE POLICY products_anon_read ON public.products
  FOR SELECT TO anon USING (true);

-- No INSERT/UPDATE/DELETE policy for anon. Anon cannot mutate products.

-- 5. Inventory: keep RLS so anon cannot touch it. The admin API uses service role.
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
-- No policies for anon — anon has no access at all.

-- ============================================================================
-- Verify
-- ============================================================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' ORDER BY ordinal_position;
--
-- SELECT * FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
-- ============================================================================
