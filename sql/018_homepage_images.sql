-- ============================================================================
-- Shree Collection — Homepage Images Migration 018
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Project → SQL → New query).
--
-- Creates the homepage_images table: keyed by slot name (hero, category_saree,
-- etc.), holds an image URL. The admin UI writes here, the storefront reads
-- from here.
--
-- WHY NO API ROUTES
-- -----------------
-- Previous iteration (a9723ca) introduced /api/admin/homepage-images and
-- /api/homepage-images serverless functions. That change broke the Vercel
-- deploy. This migration is a deliberately minimal alternative:
--   • No new serverless functions. The admin UI writes directly to Supabase
--     using the anon key plus a service-role bypass for INSERT/UPDATE/DELETE
--     (handled in the JS via the service role key fetched at admin login time
--     and stored in sessionStorage). The storefront reads via the anon key
--     with the public-select policy below.
--   • One small RLS-locked table. Six rows, one per slot. UPDATE/DELETE/INSERT
--     are denied to anon (so a casual browser cannot rewrite the homepage).
--     The admin layer carries a bearer token issued by /api/login (which
--     already exists and is in production) and POSTs the service-role key
--     along with the write — that key is the only thing that bypasses RLS.
--
-- SIX SLOTS
-- ---------
--   hero, category_saree, category_kurta, category_lehenga,
--   about_heritage, promo_banner
--
-- The slot names are stable. To add a new one, just insert another row.
-- ============================================================================

create table if not exists public.homepage_images (
    slot        text        primary key,
    image_url   text        not null,
    updated_at  timestamptz not null default now()
);

alter table public.homepage_images enable row level security;

drop policy if exists "homepage_images_anon_read"  on public.homepage_images;
drop policy if exists "homepage_images_no_anon_write" on public.homepage_images;

-- Public read: storefront fetches via anon key.
create policy "homepage_images_anon_read" on public.homepage_images
    for select to anon using (true);

-- Deny all writes by anon. Writes happen via service role key from the
-- admin panel; service role bypasses RLS so no write policy is needed.
create policy "homepage_images_no_anon_write" on public.homepage_images
    for insert to anon with check (false);
create policy "homepage_images_no_anon_update" on public.homepage_images
    for update to anon using (false);
create policy "homepage_images_no_anon_delete" on public.homepage_images
    for delete to anon using (false);

-- Also block authenticated role (we don't have any real auth users, but
-- defence in depth in case someone signs up a user later).
create policy "homepage_images_no_auth_write" on public.homepage_images
    for insert to authenticated with check (false);
create policy "homepage_images_no_auth_update" on public.homepage_images
    for update to authenticated using (false);
create policy "homepage_images_no_auth_delete" on public.homepage_images
    for delete to authenticated using (false);

-- Grant table-level access so the anon role can issue SELECT.
grant usage on schema public to anon;
grant select on public.homepage_images to anon;

-- Seed the six slots with sensible Unsplash defaults so the storefront
-- has something to show even before the admin uploads anything.
insert into public.homepage_images (slot, image_url) values
    ('hero',             'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1600&q=80'),
    ('category_saree',   'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80'),
    ('category_kurta',   'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&q=80'),
    ('category_lehenga', 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800&q=80'),
    ('about_heritage',   'https://images.unsplash.com/photo-1567225557594-88d73e55f2cb?w=800&q=80'),
    ('promo_banner',     'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&q=80')
on conflict (slot) do nothing;

comment on table  public.homepage_images is
    'Homepage image URLs. One row per slot (hero, category_*, about_heritage, promo_banner). Public read, service-role-only write.';
comment on column public.homepage_images.slot is
    'Stable slot key. Today: hero, category_saree, category_kurta, category_lehenga, about_heritage, promo_banner.';
