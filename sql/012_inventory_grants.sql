-- ============================================================================
-- Shree Collection — Fix-up: ensure anon can SELECT inventory
-- ============================================================================
-- Symptom: the storefront product page returns 401 for anon SELECTs of the
-- `inventory` table even after migration 011's `inventory_anon_read` RLS
-- policy was created. Cause: Supabase requires BOTH the RLS policy AND a
-- table-level GRANT to the role. RLS only narrows; it does not grant.
--
-- This script is fully idempotent. Run it in the Supabase SQL editor.
-- ============================================================================

-- 1. Table-level GRANTs so the anon role can SELECT inventory through
--    the RLS policy, and the service_role key can do all CRUD for the
--    admin endpoints.
GRANT SELECT ON public.inventory TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO service_role;

-- 2. RLS policy for anon SELECT (re-creates it in case the prior
--    migration didn't land on the target project).
DROP POLICY IF EXISTS inventory_anon_read ON public.inventory;
CREATE POLICY inventory_anon_read ON public.inventory
  FOR SELECT TO anon USING (true);

-- 3. Make sure the atomic RPCs exist and are executable. Re-creating
--    with `OR REPLACE` is safe — the bodies are deterministic.
CREATE OR REPLACE FUNCTION public.decrement_inventory(
  p_product_id BIGINT,
  p_color TEXT,
  p_size TEXT,
  p_qty INT
)
RETURNS TABLE (new_quantity INT) AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'decrement_inventory requires a positive qty (got %)', p_qty
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.inventory
  SET quantity = quantity - p_qty
  WHERE product_id = p_product_id
    AND color = p_color
    AND size = p_size
    AND quantity >= p_qty
  RETURNING quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.restore_inventory(
  p_product_id BIGINT,
  p_color TEXT,
  p_size TEXT,
  p_qty INT
)
RETURNS TABLE (new_quantity INT) AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'restore_inventory requires a positive qty (got %)', p_qty
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.inventory
  SET quantity = quantity + p_qty
  WHERE product_id = p_product_id
    AND color = p_color
    AND size = p_size
  RETURNING quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.decrement_inventory(BIGINT, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_inventory(BIGINT, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;

-- ============================================================================
-- Verify
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='inventory' ORDER BY ordinal_position;
--   SELECT COUNT(*) FROM public.inventory;     -- product_count * colors * sizes
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('decrement_inventory','restore_inventory');
-- ============================================================================
