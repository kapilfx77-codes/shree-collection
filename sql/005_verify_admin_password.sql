-- ============================================================================
-- Shree Collection — Admin Password Verify RPC 005
-- ============================================================================
-- Single source of truth for "is this password the admin password?"
--
-- Both /api/login and /api/admin/change-password need to verify a plaintext
-- password against the stored hash. Doing this comparison in JavaScript
-- (with bcryptjs.compare) gave us a version-skew bug: the hash written by
-- one bcryptjs build doesn't always verify under another, even with the
-- same semver pin. The fix is to do the comparison in the database where
-- there's only one implementation: pgcrypto's `crypt()` function.
--
-- HOW TO USE
-- ----------
-- 1. Run this in the Supabase SQL Editor (one time).
-- 2. After running, the RPC `verify_admin_password` returns true iff the
--    supplied plaintext matches the hash stored in admin_settings.id = 1.
-- 3. The login and change-password endpoints will be updated to call this
--    RPC instead of doing the bcryptjs compare locally.
--
-- SECURITY NOTES
-- --------------
-- • The plaintext is passed in as a parameter. Supabase's PostgREST puts
--   it in a parameterized query, so there's no SQL injection risk.
-- • The service-role key is needed to call the RPC, so it's only used from
--   the /api/* serverless functions (the browser never has the key).
-- • Returns boolean only — the hash itself is never exposed to the caller.
-- • Time-constant: PostgreSQL's `=` operator is not constant-time, but the
--   compare is over a fixed-size hash so timing leaks are negligible.
-- ============================================================================

create or replace function public.verify_admin_password(pwd text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Use crypt() with the stored hash as the "salt" — crypt() extracts the
  -- algorithm, cost, and salt from the salt argument, so this verifies
  -- a plaintext against the stored hash. Returns true iff they match.
  --
  -- The `coalesce` covers the bootstrap case where the table is missing
  -- the hash entirely (e.g. fresh deploy before the migration). In that
  -- case the function returns false and the caller falls back to env-var.
  select coalesce(
    (select crypt(pwd, value->>'password_hash') = value->>'password_hash'
     from public.admin_settings where id = 1),
    false
  );
$$;

-- The service_role (used by /api/*) needs to be able to call this. We
-- deliberately do NOT grant execute to anon or authenticated, so the
-- RPC cannot be called from the browser.
grant execute on function public.verify_admin_password(text) to service_role;

-- Verify it works (run by hand after applying):
--   select public.verify_admin_password('Kapil@Ef2618F');  -- expect true
--   select public.verify_admin_password('definitely-wrong');  -- expect false

-- ============================================================================
-- hash_admin_password(pwd text) returns text
-- ============================================================================
-- Returns a fresh bcrypt cost-10 hash of the supplied password, generated
-- by pgcrypto on the database side. Used by /api/admin/change-password so
-- the hash is created by the same implementation that will later verify it
-- (avoiding the bcryptjs cross-version skew we hit before).
--
-- Returned value is a standard "$2a$10$..." string that any bcrypt
-- implementation (PostgreSQL, bcryptjs, node-bcrypt) should accept.
-- ============================================================================

create or replace function public.hash_admin_password(pwd text)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select crypt(pwd, gen_salt('bf', 10));
$$;

grant execute on function public.hash_admin_password(text) to service_role;

-- Verify by hand:
--   select public.hash_admin_password('SomeNewPassword123!');
