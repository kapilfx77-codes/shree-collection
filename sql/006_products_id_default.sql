-- ============================================================================
-- Shree Collection — Migration 006: fix products.id default
-- ============================================================================
-- The live `products.id` column on the new Supabase project is
-- `bigint NOT NULL` with no DEFAULT. admin.js calls
-- `adminCreateProduct(payload)` and does NOT supply an id — it expects
-- the database to auto-generate one (per `sql/000_full_init.sql` which
-- says `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`).
--
-- The live schema is `bigint` (created via Supabase's table editor
-- or an earlier version of the migration), not `UUID`, so the
-- documented default `gen_random_uuid()` does not work here — that
-- function returns a UUID, which won't cast to bigint.
--
-- What this migration does:
--   1. Creates a bigint sequence owned by products.id.
--   2. Sets products.id DEFAULT to nextval(that sequence).
--   3. The `owned by` clause ties the sequence's lifetime to the
--      table — dropping products will drop the sequence too.
--
-- After this, adminCreateProduct will succeed: the database will
-- auto-generate an id, and the POST that previously failed with
--   23502: null value in column "id" of relation "products"
-- will return 201.
--
-- Note: `sql/000_full_init.sql` should be updated to reflect the
-- real shape of the table (bigint, not UUID) so a future fresh
-- deploy doesn't reintroduce the bug. That's a separate edit;
-- this migration is the minimum needed to unblock the admin UI.
-- ============================================================================

create sequence if not exists public.products_id_seq;
alter table public.products
    alter column id set default nextval('public.products_id_seq');
alter sequence public.products_id_seq owned by public.products.id;

-- Sanity check (run by hand after applying — should return a row with
-- column_default like 'nextval('products_id_seq'::regclass)'):
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'products' and column_name = 'id';
