-- ============================================================================
-- Shree Collection — Fix unit_cost ambiguity in consume_fifo_batches (015b)
-- ============================================================================
-- Symptom: calling consume_fifo_batches returns HTTP 400 with:
--   "column reference 'unit_cost' is ambiguous"
--
-- Root cause: the FOR LOOP SELECT uses `unit_cost` without qualifying the
-- table name. Since the function also has an OUT parameter named `unit_cost`,
-- PostgreSQL can't resolve which one is meant. Qualifying it as
-- `inventory_cost_batches.unit_cost` fixes the ambiguity.
-- ============================================================================

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
      v_r record;
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

-- Verify: should now return a row instead of HTTP 400
-- SELECT * FROM consume_fifo_batches(23, 'Red', 'M', 1);
