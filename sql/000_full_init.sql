-- ============================================================================
-- Shree Collection — Full Database Init (for a brand-new Supabase project)
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor (Project → SQL → New query).
-- It creates the three tables the app needs, the indexes, the auto-update
-- trigger, the admin columns, the hardened RLS policies, the variant-level
-- inventory table, and the atomic decrement/restore RPCs in a single
-- transaction-friendly script.
--
-- Re-running is safe: every CREATE uses IF NOT EXISTS, every ALTER uses
-- ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS makes policies
-- idempotent, and the RPCs use CREATE OR REPLACE.
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
  -- See sql/009_payment_verification.sql and sql/010_payment_rejection_audit.sql
  -- for the audit rationale.
  payment_verified_at        TIMESTAMPTZ,
  payment_verified_by        TEXT,
  payment_verification_source TEXT,
  payment_rejected_at        TIMESTAMPTZ,
  payment_rejected_by        TEXT,
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
-- 3. INVENTORY — variant-level (product_id, color, size)
-- ---------------------------------------------------------------------------
-- One row per (product, color, size) combination. Composite primary key
-- enforces the logical key. CHECK constraints guarantee quantity never
-- goes negative. `available` is a generated column; the storefront and
-- cart read it directly. The decrement / restore RPCs in section 9
-- keep the table consistent under concurrent order creation.
CREATE TABLE IF NOT EXISTS public.inventory (
  product_id    BIGINT NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  color         TEXT   NOT NULL,
  size          TEXT   NOT NULL,
  quantity      INT    NOT NULL DEFAULT 0,
  reserved      INT    NOT NULL DEFAULT 0,
  available     INT GENERATED ALWAYS AS (quantity - reserved) STORED,
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, color, size)
);

-- Non-negative stock guarantees. Without these, a buggy decrement could
-- silently drive `quantity` below zero and the storefront would think
-- negative stock is available.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_quantity_nonneg') THEN
    ALTER TABLE public.inventory ADD CONSTRAINT inventory_quantity_nonneg CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_reserved_nonneg') THEN
    ALTER TABLE public.inventory ADD CONSTRAINT inventory_reserved_nonneg CHECK (reserved >= 0);
  END IF;
END $$;

-- Prefix-only inventory lookups (per-product variant list) skip the
-- composite PK so this small index helps.
CREATE INDEX IF NOT EXISTS idx_inventory_product
  ON public.inventory (product_id);

-- Auto-update last_updated on row changes.
DROP TRIGGER IF EXISTS trg_inventory_updated_at ON public.inventory;
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(last_updated);

-- ---------------------------------------------------------------------------
-- 4. RLS — anon can read products and inventory; insert orders; nothing else.
-- ---------------------------------------------------------------------------
-- Important Supabase gotcha: `service_role` is NOT a superuser. RLS policies
-- only restrict; the underlying table-level GRANT to the role is also needed
-- before the service_role key can SELECT / INSERT / UPDATE / DELETE. Without
-- the GRANTs at the end of this section, /api/admin/* POST/PATCH/DELETE all
-- 403 even though the RLS policies would have allowed them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders    ENABLE ROW LEVEL SECURITY;
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

-- inventory: anon can SELECT (product page and cart draw stock badges) but
-- cannot INSERT/UPDATE/DELETE. The decrement/restore RPCs in section 9
-- are SECURITY DEFINER — anon callers can mutate stock only through them,
-- not via direct table writes.
DROP POLICY IF EXISTS inventory_anon_read ON public.inventory;
CREATE POLICY inventory_anon_read ON public.inventory
  FOR SELECT TO anon USING (true);

-- Service role gets full read+write on all three admin-managed tables.
-- (The same fix lives in sql/007_admin_table_grants.sql for projects
-- that already ran this init without these GRANTs.)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO service_role;

-- ---------------------------------------------------------------------------
-- 5. ATOMIC INVENTORY RPCs — variant-level decrement and restore
-- ---------------------------------------------------------------------------
-- The order pipeline calls these instead of writing to `inventory` directly
-- so two concurrent orders for the last unit cannot both succeed. The
-- `WHERE quantity >= p_qty` filter is the race-safety net: Postgres
-- serializes row-level updates, so two concurrent UPDATEs targeting the
-- same row resolve to exactly one match.
--
-- `decrement_inventory` returns the new quantity on success and an empty
-- result set if the variant row is missing or stock is insufficient. The
-- application interprets an empty result as "out of stock" and rolls back
-- the order.
--
-- `restore_inventory` is the inverse and is used by the admin reject-
-- payment path. The CHECK (quantity >= 0) constraint still applies, so
-- we never silently inflate past reality.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_inventory(
  p_product_id BIGINT,
  p_color TEXT,
  p_size TEXT,
  p_qty INT
)
RETURNS TABLE (new_quantity INT) AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'decrement_inventory requires a positive qty (got %)', p_qty
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.inventory
  SET quantity = quantity - p_qty
  WHERE product_id = p_product_id
    AND color = p_color
    AND size = p_size
    AND quantity >= p_qty
  RETURNING quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.restore_inventory(
  p_product_id BIGINT,
  p_color TEXT,
  p_size TEXT,
  p_qty INT
)
RETURNS TABLE (new_quantity INT) AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'restore_inventory requires a positive qty (got %)', p_qty
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.inventory
  SET quantity = quantity + p_qty
  WHERE product_id = p_product_id
    AND color = p_color
    AND size = p_size
  RETURNING quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.decrement_inventory(BIGINT, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_inventory(BIGINT, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. STORAGE — create the product-images bucket if it does not exist
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
-- \d public.inventory
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('decrement_inventory','restore_inventory');
-- ============================================================================
