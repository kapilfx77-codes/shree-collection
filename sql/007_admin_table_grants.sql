-- ============================================================================
-- Shree Collection — Admin Table Grants 007
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor.
--
-- BACKGROUND
-- 001_admin_columns.sql enabled RLS on `products`, `orders`, and `inventory`
-- and added only the SELECT-for-anon (products) and INSERT-for-anon (orders)
-- policies. The comment claimed "Service role bypasses RLS so /api/admin/*
-- still works" — which is true of RLS, but the underlying table-level GRANT
-- to the `service_role` was never made.
--
-- In Supabase, `service_role` is NOT a superuser. It is a real Postgres role
-- that, by default, has USAGE on the public schema but no per-table
-- privileges. RLS policies only restrict; the GRANT to the role is
-- independent. Without these GRANTs, every service_role write through
-- PostgREST returns 403 "permission denied for table <name>" — even though
-- the RLS policy would have allowed it.
--
-- The same pattern bit us on `admin_settings` (fixed in
-- 003_admin_settings_grants.sql). The fix for `products`, `orders`, and
-- `inventory` was missed at the time, so /api/admin/products POST/PATCH/
-- DELETE and /api/admin/orders POST/PATCH/DELETE all 403. /api/admin/
-- upload-image works because it talks to Supabase Storage, which has its
-- own (already-granted) service_role access.
--
-- VERIFY IT WORKED
--   After running, this should return a row (not 403):
--     select id, name from public.products order by id limit 1;
--   And the admin dashboard's "Add Product" form should now save.
-- ============================================================================

-- Make sure RLS is on (it should already be, but be explicit).
alter table public.products  enable row level security;
alter table public.orders   enable row level security;
alter table public.inventory enable row level security;

-- Allow the service_role to read and write these three tables. RLS is
-- still on, so the anon/authenticated roles still get no access via the
-- GRANT chain below. The anon policies added in 001 (products read, orders
-- insert) continue to work as before.
grant select, insert, update, delete on public.products  to service_role;
grant select, insert, update, delete on public.orders   to service_role;
grant select, insert, update, delete on public.inventory to service_role;
