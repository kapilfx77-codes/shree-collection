-- ============================================================================
-- Shree Collection — Tighten decrement_inventory grant (014)
-- ============================================================================
-- Symptom: a direct anonymous call to
--   POST /rest/v1/rpc/decrement_inventory
--   with the published anon key returned HTTP 200 and a decremented
--   quantity. The published test_variant_inventory.py V12 case
--   confirmed it.
--
-- Root cause
-- ----------
-- 011_variant_inventory.sql granted EXECUTE on the function to
--   anon, authenticated, service_role
-- 012_inventory_grants.sql then added a redundant grant to service_role
--   (additive; does not revoke the earlier grant to anon).
-- 013_decrement_for_update.sql tightened the body to use FOR UPDATE but
--   did not change the grants either.
--
-- Net result: any anonymous browser can drain the stock of any variant
-- simply by calling the RPC. The CHECK (quantity >= 0) constraint still
-- prevents negative stock, but an attacker can zero out any variant at
-- will and break checkout for legitimate customers.
--
-- Fix
-- ---
-- Restrict EXECUTE on the function to service_role only. The
-- storefront's only valid write path is POST /api/orders, which runs
-- server-side with the service role key. The RLS-bypassed SECURITY
-- DEFINER function should not be reachable directly from anon.
--
-- The companion restore_inventory RPC was already correctly revoked in
-- 012 (lines 83-86). This migration brings decrement_inventory in line.
-- ============================================================================

-- Idempotent: revoke from PUBLIC first (catches the default grant), then
-- from the named roles. Re-asserting service_role last so the final
-- state is exactly: only service_role may EXECUTE.
REVOKE EXECUTE ON FUNCTION public.decrement_inventory(BIGINT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_inventory(BIGINT, TEXT, TEXT, INT)
  TO service_role;

-- ============================================================================
-- Verify
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--     WHERE routine_schema='public' AND routine_name='decrement_inventory';
--   -- Expected: only 'service_role' has EXECUTE.
-- ============================================================================
