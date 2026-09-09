-- ============================================================================
-- Shree Collection — Adjust Stock with FIFO batch sync (016)
--
-- Replaces the bare inventory-only RPCs (decrement_inventory / restore_inventory)
-- with batch-aware operations for admin Adjust Stock:
--
--  * Negative delta  → consume_fifo_batches (oldest batches first)
--  * Positive delta  → add_inventory_batch (creates new named-cost batch)
--
-- The endpoint must provide p_unit_cost for positive adjustments.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Admin-adjust negative: consume FIFO batches atomically
-- ---------------------------------------------------------------------------
-- consume_fifo_batches already updates both batches and inventory.
-- It requires service_role; endpoint already uses service-role auth.
-- No new SQL needed for negative path — just use existing RPC.

-- ---------------------------------------------------------------------------
-- 2. Admin-adjust positive: add_inventory_batch (needs unit cost)
-- ---------------------------------------------------------------------------
-- add_inventory_batch creates a new FIFO batch + updates inventory.
-- The endpoint must pass p_unit_cost (from product cost_price or input).
-- No new SQL needed — existing RPC handles both.

COMMIT;
