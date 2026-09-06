-- ==========================================================================
-- sql/999_reset_test_data.sql
-- DESTRUCTIVE: Clears all business/test data from the Shree Collection DB.
-- Preserves: schema, columns, indexes, constraints, RLS, functions/RPCs,
--            extensions, auth/admin config, storage, migrations, env vars.
--
-- TABLES CLEARED (in order respecting foreign-key constraints):
--   1. orders              — top-level order records (no children)
--   2. inventory_cost_batches  — FIFO cost batches
--   3. inventory           — variant stock levels
--   4. products            — product catalog entries
--
-- EXECUTION — run via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Select project xztfoauqecnmznszghcj
--   3. SQL Editor → New Query
--   4. Paste this entire file
--   5. Click Run
--   6. Verify counts below are all 0
-- ==========================================================================

-- Step 1: Orders
-- (no FK children — batch_allocations lives as JSONB inside orders)
DELETE FROM orders;

-- Step 2: FIFO cost batches
-- (inventory_cost_batches has no DELETE grant via PostgREST service_role,
--  so we use a SECURITY DEFINER function to bypass RLS)
CREATE OR REPLACE FUNCTION public.delete_all_batches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM inventory_cost_batches;
END;
$$;

SELECT public.delete_all_batches();
DROP FUNCTION public.delete_all_batches();

-- Step 3: Products (cascades to inventory via ON DELETE CASCADE)
DELETE FROM products;

-- Verification — all should return 0
-- SELECT 'orders' as tbl, count(*) as rows FROM orders
-- UNION ALL SELECT 'inventory_cost_batches', count(*) FROM inventory_cost_batches
-- UNION ALL SELECT 'inventory', count(*) FROM inventory
-- UNION ALL SELECT 'products', count(*) FROM products;
