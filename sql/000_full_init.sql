-- ============================================================================
-- Shree Collection — Full Database Init (for a brand-new Supabase project)
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Project → SQL → New query).
-- It creates the three tables the app needs, the indexes, the auto-update
-- trigger, the admin columns, and the hardened RLS policies in a single
-- transaction-friendly script.
--
-- Re-running is safe: every CREATE uses IF NOT EXISTS, every ALTER uses
-- ADD COLUMN IF NOT EXISTS, and DROP POLICY IF EXISTS makes policies
-- idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS — moddatetime lives in the extensions schema on Supabase
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. PRODUCTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id            BIGINT PRIMARY KEY,
  name          TEXT NOT NULL,
  price         INT NOT NULL,
  original_price INT,
  description   TEXT,
  colors        TEXT[],
  sizes         TEXT[],
  images        TEXT[],
  featured      BOOLEAN NOT NULL DEFAULT FALSE,
  in_stock      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Legacy column kept for compatibility with older admin clients
  instock       BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_featured ON public.products (featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_in_stock ON public.products (in_stock) WHERE in_stock = TRUE;

-- ---------------------------------------------------------------------------
-- 2. ORDERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  city            TEXT NOT NULL,
  address         TEXT NOT NULL,
  txn             TEXT,
  items           JSONB NOT NULL,
  total           INT NOT NULL,
  -- Admin columns (added in 001 but harmless to keep here for one-shot init)
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_method  TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('cod', 'esewa')),
  payment_status  TEXT
    CHECK (payment_status IS NULL OR payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  cancelled_at    TIMESTAMPTZ,
  -- Manual eSewa payment verification trail. Populated by the admin
  -- "Verify Payment" / "Reject Payment" actions on the orders page.
  -- See sql/009_payment_verification.sql for the audit rationale.
  payment_verified_at        TIMESTAMPTZ,
  payment_verified_by        TEXT,
  payment_verification_source TEXT,
  payment_rejected_at        TIMESTAMPTZ,
  payment_rejection_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
-- Partial index for the admin "eSewa awaiting verification" queue.
CREATE INDEX IF NOT EXISTS idx_orders_esewa_pending
  ON public.orders (created_at DESC)
  WHERE payment_method = 'esewa' AND payment_status = 'pending';

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 3. INVENTORY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
  product_id    BIGINT PRIMARY KEY REFERENCES public.products (id) ON DELETE CASCADE,
  quantity      INT NOT NULL DEFAULT 0,
  reserved      INT NOT NULL DEFAULT 0,
  available     INT GENERATED ALWAYS AS (quantity - reserved) STORED,
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. RLS — anon key can only read public products, never write anything.
-- ---------------------------------------------------------------------------
-- Important Supabase gotcha: `service_role` is NOT a superuser. RLS policies
-- only restrict; the underlying table-level GRANT to the role is also needed
-- before the service_role key can SELECT / INSERT / UPDATE / DELETE. Without
-- the GRANTs at the end of this section, /api/admin/* POST/PATCH/DELETE all
-- 403 even though the RLS policies would have allowed them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- products: anon can read everything
DROP POLICY IF EXISTS products_anon_read ON public.products;
CREATE POLICY products_anon_read ON public.products
  FOR SELECT TO anon USING (true);

-- orders: anon can only INSERT (guest checkout). NO SELECT — customer PII
-- (name, phone, city, address) must not be publicly readable.
DROP POLICY IF EXISTS orders_anon_insert ON public.orders;
CREATE POLICY orders_anon_insert ON public.orders
  FOR INSERT TO anon WITH CHECK (true);

-- inventory: anon has no access at all (no policy = blocked).

-- Service role gets full read+write on all three admin-managed tables.
-- (The same fix lives in sql/007_admin_table_grants.sql for projects
-- that already ran this init without these GRANTs.)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO service_role;

-- ---------------------------------------------------------------------------
-- 5. STORAGE — create the product-images bucket if it does not exist
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- SELECT * FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders' ORDER BY ordinal_position;
-- ============================================================================
