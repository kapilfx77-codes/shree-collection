-- ============================================================================
-- Shree Collection — Batch-Based FIFO Inventory Costing
-- Migration 015
--
-- Creates the `inventory_cost_batches` table, three RPC functions, and migrates
-- existing inventory to unknown-cost batches.
--
-- Key decisions:
--   - unit_cost = NULL → "pre-migration unknown cost" (reports show it as null).
--   - FIFO = created_at ASC. Pre-migration batches are stamped 1 day in the past
--     so they ship first when old stock coexists with new-cost batches.
--   - consume_fifo_batches: atomic all-or-nothing; restores on OOS via rollback.
--   - restore_fifo_batches: idempotent; restores to exact batches from consume.
--   - add_inventory_batch: creates a new named-cost batch + syncs inventory.qty.
--   - All EXECUTE grants are to service_role only (SECURITY DEFINER bypasses RLS).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_cost_batches (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color               TEXT          NOT NULL,
  size                TEXT          NOT NULL,
  original_quantity   INT           NOT NULL CHECK (original_quantity > 0),
  remaining_quantity  INT           NOT NULL CHECK (remaining_quantity >= 0),
  unit_cost           DECIMAL(10,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- FIFO cursor: only live batches (remaining > 0) needed for consumption order.
CREATE INDEX IF NOT EXISTS idx_batches_fifo
  ON public.inventory_cost_batches (product_id, color, size, created_at ASC)
  WHERE remaining_quantity > 0;

-- Ad-hoc variant lookup (admin UI, reporting).
CREATE INDEX IF NOT EXISTS idx_batches_product
  ON public.inventory_cost_batches (product_id, color, size);

-- ---------------------------------------------------------------------------
-- 2. consume_fifo_batches
-- ---------------------------------------------------------------------------
-- Atomically consumes stock from batches in FIFO order (oldest first).
-- Returns one row per batch consumed + a total_cost in the last row.
-- If stock is insufficient, ALL updates are rolled back and a single row with
-- total_cost = -1 (sentinel) is returned so the caller can distinguish
-- "insufficient stock" from "zero-cost stock" (which is valid).
CREATE OR REPLACE FUNCTION public.consume_fifo_batches(
  p_product_id  BIGINT,
  p_color       TEXT,
  p_size        TEXT,
  p_qty         INT
)
RETURNS TABLE (
  batch_id     BIGINT,
  allocated_qty INT,
  unit_cost    DECIMAL(10,2),
  batch_cost   DECIMAL(12,2),
  total_cost   DECIMAL(14,2)
) AS $$
DECLARE
  v_needed        INT := p_qty;
  v_batch         RECORD;
  v_consumed      INT;
  v_cost          DECIMAL(12,2);
  v_running       DECIMAL(14,2) := 0;
  v_insufficient  BOOLEAN := FALSE;
BEGIN
  IF p_product_id IS NULL OR p_color IS NULL OR p_size IS NULL THEN
    RAISE EXCEPTION 'consume_fifo_batches: all arguments required' USING ERRCODE='22023';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'consume_fifo_batches: p_qty must be > 0 (got %)', p_qty USING ERRCODE='22023';
  END IF;

  -- Lock batches in FIFO order (oldest first) then consume.
  FOR v_batch IN
    SELECT id, remaining_quantity, inventory_cost_batches.unit_cost
    FROM   public.inventory_cost_batches
    WHERE  product_id = p_product_id
      AND  color      = p_color
      AND  size       = p_size
      AND  remaining_quantity > 0
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_needed <= 0;

    v_consumed := LEAST(v_batch.remaining_quantity, v_needed);

    -- Decrement batch remaining_quantity.
    UPDATE public.inventory_cost_batches
    SET    remaining_quantity = remaining_quantity - v_consumed
    WHERE  id = v_batch.id;

    -- Decrement the variant-level inventory so the storefront badge stays in sync.
    UPDATE public.inventory
    SET    quantity = quantity - v_consumed
    WHERE  product_id = p_product_id AND color = p_color AND size = p_size;

    v_cost   := COALESCE(v_batch.unit_cost, 0) * v_consumed;
    v_running := v_running + v_cost;

    batch_id      := v_batch.id;
    allocated_qty := v_consumed;
    unit_cost     := v_batch.unit_cost;
    batch_cost   := v_cost;
    total_cost   := CASE WHEN v_needed - v_consumed <= 0
                        THEN v_running ELSE NULL END;
    RETURN NEXT;

    v_needed := v_needed - v_consumed;
  END LOOP;

  -- Insufficient stock: restore what we just decremented (reverse FIFO = newest first).
  IF v_needed > 0 THEN
    v_insufficient := TRUE;
    DECLARE
      v_r RECORD;
      v_r_needed INT := p_qty - v_needed;
    BEGIN
      FOR v_r IN
        SELECT id, LEAST(remaining_quantity, v_r_needed) AS amt
        FROM public.inventory_cost_batches
        WHERE product_id = p_product_id AND color = p_color AND size = p_size
          AND remaining_quantity > 0
        ORDER BY created_at DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_r_needed <= 0;
        UPDATE public.inventory_cost_batches
        SET    remaining_quantity = remaining_quantity + v_r.amt
        WHERE  id = v_r.id;
        UPDATE public.inventory
        SET    quantity = quantity + v_r.amt
        WHERE  product_id = p_product_id AND color = p_color AND size = p_size;
        v_r_needed := v_r_needed - v_r.amt;
      END LOOP;
    END;

    -- Sentinel row so the application layer can detect the failure.
    batch_id := NULL; allocated_qty := NULL; unit_cost := NULL;
    batch_cost := NULL; total_cost := -1;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 3. restore_fifo_batches
-- ---------------------------------------------------------------------------
-- Restores quantities to exact batches from a prior consume_fifo_batches call.
-- Idempotent: calling with the same allocations twice is a no-op after the first.
-- Input: JSONB array of { batch_id, allocated_qty } objects.
CREATE OR REPLACE FUNCTION public.restore_fifo_batches(p_allocations JSONB)
RETURNS TABLE (batch_id BIGINT, restored_qty INT) AS $$
DECLARE
  v_alloc   JSONB;
  v_bid     BIGINT;
  v_qty     INT;
  v_prod_id BIGINT;
  v_col     TEXT;
  v_sz      TEXT;
BEGIN
  IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
    RETURN;
  END IF;

  FOR v_alloc IN SELECT jsonb_array_elements(p_allocations) LOOP
    v_bid := (v_alloc->>'batch_id')::BIGINT;
    v_qty := (v_alloc->>'allocated_qty')::INT;

    IF v_bid IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Look up the batch's FK values (for inventory sync).
    SELECT product_id, color, size
    INTO   v_prod_id, v_col, v_sz
    FROM   public.inventory_cost_batches
    WHERE  id = v_bid;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Restore batch (capped at original_quantity).
    UPDATE public.inventory_cost_batches
    SET    remaining_quantity = LEAST(remaining_quantity + v_qty, original_quantity)
    WHERE  id = v_bid
    RETURNING remaining_quantity INTO v_qty;

    -- Restore the variant-level inventory quantity.
    UPDATE public.inventory
    SET    quantity = quantity + v_qty
    WHERE  product_id = v_prod_id AND color = v_col AND size = v_sz;

    batch_id     := v_bid;
    restored_qty := v_qty;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 4. add_inventory_batch
-- ---------------------------------------------------------------------------
-- Adds stock with a known unit cost, creating a new FIFO batch.
-- Also upserts the variant-level inventory row.
CREATE OR REPLACE FUNCTION public.add_inventory_batch(
  p_product_id BIGINT,
  p_color      TEXT,
  p_size       TEXT,
  p_qty        INT,
  p_unit_cost  DECIMAL(10,2)
)
RETURNS TABLE (batch_id BIGINT, total_available INT) AS $$
BEGIN
  IF p_product_id IS NULL OR p_color IS NULL OR p_size IS NULL THEN
    RAISE EXCEPTION 'add_inventory_batch: product_id, color, size required' USING ERRCODE='22023';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'add_inventory_batch: p_qty must be > 0 (got %)', p_qty USING ERRCODE='22023';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'add_inventory_batch: unit_cost >= 0 required' USING ERRCODE='22023';
  END IF;

  -- Insert the new named-cost batch.
  INSERT INTO public.inventory_cost_batches
    (product_id, color, size, original_quantity, remaining_quantity, unit_cost)
  VALUES (p_product_id, p_color, p_size, p_qty, p_qty, p_unit_cost)
  RETURNING id INTO batch_id;

  -- Upsert variant-level inventory (add to existing quantity).
  INSERT INTO public.inventory (product_id, color, size, quantity)
  VALUES (p_product_id, p_color, p_size, p_qty)
  ON CONFLICT (product_id, color, size)
  DO UPDATE SET quantity = inventory.quantity + p_qty, last_updated = NOW();

  -- Return total available across all batches for this variant.
  SELECT COALESCE(SUM(remaining_quantity), 0)
  INTO total_available
  FROM public.inventory_cost_batches
  WHERE product_id = p_product_id AND color = p_color AND size = p_size;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 5. GRANT EXECUTE TO SERVICE_ROLE ONLY
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.consume_fifo_batches(BIGINT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_fifo_batches(BIGINT, TEXT, TEXT, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.restore_fifo_batches(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_fifo_batches(JSONB)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.add_inventory_batch(BIGINT, TEXT, TEXT, INT, DECIMAL)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.add_inventory_batch(BIGINT, TEXT, TEXT, INT, DECIMAL)
  TO service_role;

-- service_role needs SELECT on batches for the admin UI and reporting.
GRANT SELECT ON public.inventory_cost_batches TO service_role;

-- ---------------------------------------------------------------------------
-- 6. MIGRATE EXISTING INVENTORY → UNKNOWN-COST BATCHES
-- ---------------------------------------------------------------------------
-- Each (product_id, color, size) with qty > 0 gets one "unknown cost" batch
-- (unit_cost = NULL) stamped 1 day in the past so it ships before any new
-- named-cost batches added after this migration.
INSERT INTO public.inventory_cost_batches
  (product_id, color, size, original_quantity, remaining_quantity, unit_cost, created_at)
SELECT
  i.product_id,
  i.color,
  i.size,
  i.quantity,
  i.quantity,
  NULL::DECIMAL,
  NOW() - INTERVAL '1 day'
FROM public.inventory i
WHERE i.quantity > 0
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. VERIFICATION
-- ---------------------------------------------------------------------------
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'inventory_cost_batches';
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('consume_fifo_batches','restore_fifo_batches','add_inventory_batch');
-- SELECT * FROM inventory_cost_batches LIMIT 5;
-- SELECT schemaname, rolname, proname, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE proname IN ('consume_fifo_batches','restore_fifo_batches','add_inventory_batch')
--   ORDER BY proname, rolname;

COMMIT;
