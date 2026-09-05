-- ============================================================================
-- Shree Collection — Admin Password Reset 004 (one-shot)
-- ============================================================================
-- The admin is currently locked out because the password stored in
-- admin_settings is unknown (likely the test password that was set
-- during a previous run of the change-password e2e test, whose cleanup
-- step failed).
--
-- The change-password endpoint enforces a 12-character minimum with 3
-- of: lowercase, uppercase, digit, symbol. The original seed default
-- 'shree2026' is 9 chars and cannot be set through the API; it can
-- only be set via this kind of direct DB write.
--
-- HOW TO USE
-- ----------
-- 1. Take a backup of the current row (optional, for forensics):
--      select value->'password_hash' as hash_prefix_only, updated_at
--        from public.admin_settings;
--
-- 2. Pick a new password that meets the policy:
--      - at least 12 characters
--      - at least 3 of: lowercase, uppercase, digit, symbol
--
-- 3. Replace 'PUT_NEW_PASSWORD_HERE_BETWEEN_QUOTES' below with your
--    chosen password (keep the surrounding single quotes).
--
-- 4. Run this script in the Supabase SQL editor.
--
-- 5. Sign in to the dashboard with the new password.
--
-- 6. Change the password to something personal via Settings → Security.
--    The change-password endpoint will then be the steady-state path
--    and this script won't be needed again.
-- ============================================================================

update public.admin_settings
set value = jsonb_set(
        value,
        '{password_hash}',
        crypt('PUT_NEW_PASSWORD_HERE_BETWEEN_QUOTES', gen_salt('bf', 10)),
        false
     ),
    updated_at = now()
where id = 1;
