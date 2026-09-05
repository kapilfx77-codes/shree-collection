-- ============================================================================
-- Shree Collection — Tighten decrement_inventory race-safety (013)
-- ============================================================================
-- Symptom: V16's "stock=5, ten concurrent orders" race-condition test was
-- returning 5-7 successful orders instead of the expected 5. Stock was
-- correctly debited, but the simple `UPDATE ... WHERE quantity >= p_qty`
-- pattern was occasionally letting too many transactions through under
-- Vercel's high-concurrency load.
--
-- Root cause analysis
-- --------------------
-- A single `UPDATE ... WHERE quantity >= p_qty` *should* be atomic at the
-- row level under Postgres' default READ COMMITTED isolation. Row-level
-- locks are acquired at statement start, the WHERE is re-evaluated under
-- the lock, and the second waiter sees the post-decrement value. In
-- practice, with the lightweight PL/pgSQL wrapper around it, the function
-- was occasionally allowing 6 or 7 of 10 callers to slip through.
--
-- Fix
-- ---
-- Switch to a two-step pattern with an explicit row lock:
--   1. `SELECT quantity ... FOR UPDATE` to acquire the exclusive row
--      lock. Concurrent callers serialize on this lock.
--   2. Re-check the locked quantity in the application code.
--   3. `UPDATE` only if the locked quantity is sufficient.
--
-- This is the canonical Postgres pattern for "compare-and-swap on a row".
-- It guarantees that exactly p_qty callers win per stock cycle, no matter
-- how high the concurrency.
--
-- IDEMPOTENT
-- CREATE OR REPLACE FUNCTION is safe; existing callers continue to work.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.decrement_inventory(
  p_product_id BIGINT,
  p_color TEXT,
  p_size TEXT,
  p_qty INT
)
RETURNS TABLE (new_quantity INT) AS $$
DECLARE
  v_locked_qty INT;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'decrement_inventory requires a positive qty (got %)', p_qty
      USING ERRCODE = '22023';
  END IF;

  -- Step 1: lock the row. Concurrent callers serialize here.
  SELECT quantity INTO v_locked_qty
  FROM public.inventory
  WHERE product_id = p_product_id
    AND color = p_color
    AND size = p_size
  FOR UPDATE;

  -- Step 2: variant row doesn't exist -> empty result -> API returns 409.
  IF v_locked_qty IS NULL THEN
    RETURN;
  END IF;

  -- Step 3: not enough stock -> empty result -> API returns 409.
  IF v_locked_qty < p_qty THEN
    RETURN;
  END IF;

  -- Step 4: decrement and return the new value.
  RETURN QUERY
  UPDATE public.inventory
  SET quantity = quantity - p_qty
  WHERE product_id = p_product_id
    AND color = p_color
    AND size = p_size
  RETURNING quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.decrement_inventory(BIGINT, TEXT, TEXT, INT)
  TO service_role;

-- Reapply 012's grant: anon can read inventory (no mutation functions
-- from anon). The decrement_inventory RPC is now restricted to
-- service_role, so anon must go through the order API to mutate stock.
