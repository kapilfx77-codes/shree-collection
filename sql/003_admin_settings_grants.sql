-- ============================================================================
-- Shree Collection — Admin Settings Grants 003
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor.
--
-- BACKGROUND
-- 002_admin_settings.sql created the admin_settings table and locked it down
-- with RLS. The intent was that only the Supabase service_role key could
-- read or write it, since the /api/* serverless functions use that key.
--
-- But Supabase's service_role is *not* a superuser for table access. RLS
-- policies only restrict; the underlying GRANT to the role is also needed
-- before the service_role can SELECT / INSERT / UPDATE / DELETE on the
-- table. Without these GRANTs, even the service_role key gets 403.
--
-- VERIFY IT WORKED
--   After running, this should return 200 + a row:
--     select * from public.admin_settings where id = 1;
-- ============================================================================

-- Make sure RLS is on (it should already be, but be explicit).
alter table public.admin_settings enable row level security;

-- Allow the service_role to read and write. Without this, the API gets 403
-- "permission denied for table admin_settings" even when presenting the
-- service_role key. RLS is still on, so the anon/authenticated roles get
-- no access via the GRANT chain below.
grant select, insert, update, delete on public.admin_settings to service_role;
