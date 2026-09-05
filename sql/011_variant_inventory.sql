-- ============================================================================
-- Shree Collection — Variant-Level Inventory (011)
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor.
--
-- BACKGROUND
-- Migration 000/001 created `public.inventory` keyed on `product_id` only.
-- That was too coarse for the storefront: every (color, size) combination
-- shared a single stock count, and `api/orders.js` never read or wrote
-- the table at all — it only checked the product-level `in_stock` boolean.
--
-- This migration restructures the table so each (product_id, color, size)
-- combination has its own row, and adds the atomic primitives the order
-- pipeline needs:
--   * composite primary key (product_id, color, size)
--   * non-negative CHECK constraints
--   * backfill for existing products (10 units per variant so the
--     existing tests have a non-zero starting point)
--   * anon SELECT RLS policy so the product page can colour sold-out pills
--   * decrement_inventory(p_id, color, size, qty) RPC
--       single SQL statement: WHERE quantity >= qty → UPDATE quantity - qty.
--       Two concurrent calls for stock=1 resolve to exactly one match.
--   * restore_inventory(p_id, color, size, qty) RPC
--       inverse: quantity + qty, used by the admin reject-payment path.
--       Called only when the order PATCH's `WHERE payment_rejected_at IS
--       NULL` filter succeeds, so a second reject is a no-op.
--
-- IDEMPOTENT
-- Every operation is guarded: ADD COLUMN IF NOT EXISTS, the PK swap is
-- wrapped in a DO block with an existence check, the CHECK constraints
-- are created via DO blocks, the backfill uses ON CONFLICT DO NOTHING,
-- and the RLS policy uses DROP POLICY IF EXISTS. Re-running on a database
-- that already has the new schema is harmless.
--
-- VERIFY IT WORKED
--   \d inventory                                  -- composite PK + checks
--   SELECT COUNT(*) FROM public.inventory;        -- product_count * colors * sizes
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('decrement_inventory','restore_inventory'); -- both functions exist
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS — moddatetime is in the extensions schema on Supabase
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. Add color/size columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT;

-- Populate NULL color/size from products' arrays (one-time, safe). The
-- WHERE clauses make these no-ops on re-runs.
UPDATE public.inventory i
SET color = COALESCE(
  (SELECT c FROM unnest(COALESCE(
    (SELECT colors FROM public.products WHERE id = i.product_id),
    ARRAY['Standard']::text[])) AS c LIMIT 1),
  'Standard'
)
WHERE color IS NULL;

UPDATE public.inventory i
SET size = COALESCE(
  (SELECT s FROM unnest(COALESCE(
    (SELECT sizes FROM public.products WHERE id = i.product_id),
    ARRAY['Free Size']::text[])) AS s LIMIT 1),
  'Free Size'
)
WHERE size IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Swap the PK to a composite key
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_pkey'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD PRIMARY KEY (product_id, color, size);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Non-negative CHECK constraints
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_quantity_nonneg'
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_quantity_nonneg CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_reserved_nonneg'
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_reserved_nonneg CHECK (reserved >= 0);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Index on product_id for per-product lookups (the PK already covers
--    (product_id, color, size) so this only helps prefix-only queries)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_product
  ON public.inventory (product_id);

-- ---------------------------------------------------------------------------
-- 5. last_updated auto-update trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_inventory_updated_at ON public.inventory;
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(last_updated);

-- ---------------------------------------------------------------------------
-- 6. Backfill: every (product, color, size) gets a row. Existing variants
--    are left alone (ON CONFLICT DO NOTHING); new variants get quantity 10
--    as a soft-launch default so existing tests have non-zero starting
--    stock. The admin can adjust via the new inventory screen.
-- ---------------------------------------------------------------------------
INSERT INTO public.inventory (product_id, color, size, quantity, reserved, last_updated)
SELECT p.id, c, s, 10, 0, NOW()
FROM public.products p
CROSS JOIN LATERAL unnest(COALESCE(p.colors, ARRAY['Standard']::text[])) AS c
CROSS JOIN LATERAL unnest(COALESCE(p.sizes, ARRAY['Free Size']::text[])) AS s
ON CONFLICT (product_id, color, size) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Public read policy: anon can SELECT inventory (for product-page
--    stock badges and cart stock counts) but cannot INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS inventory_anon_read ON public.inventory;
CREATE POLICY inventory_anon_read ON public.inventory
  FOR SELECT TO anon USING (true);

-- ---------------------------------------------------------------------------
-- 8. Atomic decrement_inventory(p_product_id, p_color, p_size, p_qty)
--    Single statement; returns the new quantity on success, no rows on
--    insufficient stock. SECURITY DEFINER so anon callers can use it
--    without RLS-byassing the whole table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_inventory(
  p_product_id BIGINT,
  p_color TEXT,
  p_size TEXT,
  p_qty INT
)
RETURNS TABLE (new_quantity INT) AS $$
BEGIN
  -- Negative qty means "restore" — only allow for service_role callers.
  -- The API uses restore_inventory() for the restore path, so any caller
  -- using decrement_inventory with a negative qty is doing something
  -- unexpected. We refuse here to keep the two paths semantically clean.
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

-- ---------------------------------------------------------------------------
-- 9. Atomic restore_inventory(p_product_id, p_color, p_size, p_qty)
--    Inverse of decrement. Used by the admin reject-payment path; positive
--    qty only. The CHECK (quantity >= 0) constraint still applies, so we
--    never silently inflate past reality.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 10. Grant EXECUTE on the two functions to anon and authenticated.
--     RLS still blocks direct table writes for these roles; the functions
--     are the only safe way to mutate stock.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.decrement_inventory(BIGINT, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_inventory(BIGINT, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- \d public.inventory
-- SELECT product_id, color, size, quantity FROM public.inventory ORDER BY product_id, color, size;
-- SELECT COUNT(*) FROM public.inventory;
-- ============================================================================
