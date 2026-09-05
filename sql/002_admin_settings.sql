-- ============================================================================
-- Shree Collection — Admin Settings Migration 002
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Project → SQL → New query).
--
-- Creates the admin_settings table: a single-row key/value store that holds
-- the admin password hash and the session secret used to sign admin session
-- tokens. The admin UI uses this table to support password changes without
-- requiring a redeploy of Vercel env vars (which is impossible from inside a
-- serverless function anyway).
--
-- SECURITY MODEL
-- --------------
--   • The table is locked down. Anon has NO access; only the service role key
--     (held only inside /api/* serverless functions) can read or write.
--   • The password is stored as a bcrypt hash, never as plaintext.
--   • The session secret is stored in plaintext because we need its exact
--     value to sign HMACs (a hash of the secret would not work as a secret).
--     It is still protected by the same RLS as the password hash.
--
-- BOOTSTRAP BEHAVIOUR
-- -------------------
--   • The seed row's password hash matches the value in process.env.ADMIN_PASSWORD
--     at the time of migration (default: 'shree2026'). The /api/login handler
--     also falls back to process.env.ADMIN_PASSWORD if the row cannot be
--     read, so this migration is safe to run at any time.
--   • After running this migration, change the password from the admin UI
--     (Settings → Security) so the password hash and the env-var fallback
--     diverge — that is the intended steady state.
--
-- VERIFY
-- ------
--   • Run:  select key, value, updated_at from public.admin_settings;
--   • You should see exactly one row with key = 'auth' and a jsonb value
--     containing `password_hash` and `session_secret` (both as text).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. admin_settings table
-- ---------------------------------------------------------------------------
-- Single-row table (enforced by primary-key-as-constant id=1) holding a
-- jsonb blob. Today the blob has shape:
--   {
--     "password_hash":    "$2a$10$...",        -- bcrypt cost 10 of ADMIN_PASSWORD
--     "session_secret":   "<32 random hex>"   -- signs admin session HMACs
--   }
-- Adding more keys later (e.g. "store_name") is just a matter of writing
-- a new field on the same row.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_settings (
    id          smallint    primary key default 1 check (id = 1),
    value       jsonb       not null,
    updated_at  timestamptz not null default now()
);

-- 2. Enable RLS and lock the table down to NO public access. The only
--    client that can read or write this table is the Supabase service role
--    key, which bypasses RLS by design and is held only inside the Vercel
--    /api/* serverless functions. No anon key, no authenticated user, gets
--    in. This matches the rest of the admin tables (orders, products).
alter table public.admin_settings enable row level security;

-- Drop any prior policies (idempotent in case this migration is re-run).
drop policy if exists "admin_settings_no_anon_select"  on public.admin_settings;
drop policy if exists "admin_settings_no_anon_insert"  on public.admin_settings;
drop policy if exists "admin_settings_no_anon_update"  on public.admin_settings;
drop policy if exists "admin_settings_no_anon_delete"  on public.admin_settings;
drop policy if exists "admin_settings_no_auth_select"  on public.admin_settings;
drop policy if exists "admin_settings_no_auth_insert"  on public.admin_settings;
drop policy if exists "admin_settings_no_auth_update"  on public.admin_settings;
drop policy if exists "admin_settings_no_auth_delete"  on public.admin_settings;

-- Explicit "deny all" policies. service role bypasses RLS so it can still
-- read+write. Without these policies RLS still denies anon by default,
-- but stating the denials explicitly makes the intent auditable.
create policy "admin_settings_no_anon_select" on public.admin_settings
    for select to anon   using (false);
create policy "admin_settings_no_anon_insert" on public.admin_settings
    for insert to anon   with check (false);
create policy "admin_settings_no_anon_update" on public.admin_settings
    for update to anon   using (false);
create policy "admin_settings_no_anon_delete" on public.admin_settings
    for delete to anon   using (false);
create policy "admin_settings_no_auth_select" on public.admin_settings
    for select to authenticated using (false);
create policy "admin_settings_no_auth_insert" on public.admin_settings
    for insert to authenticated with check (false);
create policy "admin_settings_no_auth_update" on public.admin_settings
    for update to authenticated using (false);
create policy "admin_settings_no_auth_delete" on public.admin_settings
    for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- 3. Seed the single row.
-- ---------------------------------------------------------------------------
-- password_hash  → bcrypt cost-10 of the current ADMIN_PASSWORD env var, or
--                  the documented default 'shree2026' if no override was set
--                  on Vercel at migration time.
-- session_secret → 32 random bytes (256 bits) hex-encoded, generated by
--                  gen_random_bytes(). This is the value the new
--                  admin-auth.js will sign session tokens with.
--
-- IMPORTANT: crypt() here is run by the Supabase Postgres role, which
-- happens to have access to pgcrypto's bcrypt. Vercel's Node runtime also
-- has access to bcryptjs, so /api/login.js will verify using bcryptjs's
-- compare() against this hash. The algorithm identifier ($2a$) is shared.
-- ---------------------------------------------------------------------------
insert into public.admin_settings (id, value, updated_at)
values (
    1,
    jsonb_build_object(
        'password_hash',
        crypt(
            coalesce(
                current_setting('app.admin_password', true),
                'shree2026'
            ),
            gen_salt('bf', 10)
        ),
        'session_secret',
        encode(gen_random_bytes(32), 'hex')
    ),
    now()
)
on conflict (id) do nothing;

-- If a row was already there (re-run of the migration), do NOT overwrite
-- the existing hash / secret — that would invalidate the running admin
-- session. The upsert above uses on conflict do nothing precisely to
-- preserve an existing live row.

-- ---------------------------------------------------------------------------
-- 4. Audit
-- ---------------------------------------------------------------------------
comment on table  public.admin_settings is
    'Admin dashboard key/value store. Holds bcrypt admin password hash and HMAC session secret. RLS-locked; only service role can read or write.';
comment on column public.admin_settings.value is
    'JSON blob. Today: {"password_hash": "<bcrypt>", "session_secret": "<hex>"}.';
