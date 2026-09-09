-- ============================================================================
-- SQL 017: Reconcile existing inventory against FIFO batches (safe, idempotent)
-- ============================================================================
-- For each (product_id, color, size):
--   inventory.qty  should equal SUM(batch.remaining_quantity)
-- This script produces a report of mismatches; it does NOT auto-correct,
-- to avoid corrupting history or orders.
-- ============================================================================
SELECT
  i.product_id,
  i.color,
  i.size,
  i.quantity AS inventory_qty,
  COALESCE(SUM(b.remaining_quantity), 0) AS batch_total,
  i.quantity - COALESCE(SUM(b.remaining_quantity), 0) AS diff
FROM public.inventory i
LEFT JOIN public.inventory_cost_batches b
  ON  i.product_id = b.product_id
  AND i.color      = b.color
  AND i.size       = b.size
GROUP BY i.product_id, i.color, i.size, i.quantity
HAVING i.quantity != COALESCE(SUM(b.remaining_quantity), 0);
