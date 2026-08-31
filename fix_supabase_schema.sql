-- ============================================================================
-- SHREE COLLECTION - SUPABASE SCHEMA FIX
-- ============================================================================
-- Run this entire script in Supabase SQL Editor to fix permission and schema issues

-- 1. DROP existing policies (if they exist)
DROP POLICY IF EXISTS "products_read" ON products;
DROP POLICY IF EXISTS "products_insert" ON products;
DROP POLICY IF EXISTS "products_update" ON products;
DROP POLICY IF EXISTS "products_delete" ON products;
DROP POLICY IF EXISTS "orders_create" ON orders;
DROP POLICY IF EXISTS "orders_read" ON orders;
DROP POLICY IF EXISTS "orders_update" ON orders;
DROP POLICY IF EXISTS "orders_delete" ON orders;
DROP POLICY IF EXISTS "inventory_read" ON inventory;

-- 2. ALTER products table to add missing inStock column (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'instock'
    ) THEN
        ALTER TABLE products ADD COLUMN inStock BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- 3. Create comprehensive RLS policies for products (CRUD operations)
CREATE POLICY "products_select_policy"
ON products FOR SELECT
USING (true);

CREATE POLICY "products_insert_policy"
ON products FOR INSERT
WITH CHECK (true);

CREATE POLICY "products_update_policy"
ON products FOR UPDATE
USING (true);

CREATE POLICY "products_delete_policy"
ON products FOR DELETE
USING (true);

-- 4. Create comprehensive RLS policies for orders (CRUD operations)
CREATE POLICY "orders_select_policy"
ON orders FOR SELECT
USING (true);

CREATE POLICY "orders_insert_policy"
ON orders FOR INSERT
WITH CHECK (true);

CREATE POLICY "orders_update_policy"
ON orders FOR UPDATE
USING (true);

CREATE POLICY "orders_delete_policy"
ON orders FOR DELETE
USING (true);

-- 5. Create policies for inventory
CREATE POLICY "inventory_select_policy"
ON inventory FOR SELECT
USING (true);

CREATE POLICY "inventory_insert_policy"
ON inventory FOR INSERT
WITH CHECK (true);

CREATE POLICY "inventory_update_policy"
ON inventory FOR UPDATE
USING (true);

-- 6. Grant necessary permissions to anon role
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO anon;
GRANT SELECT, INSERT, UPDATE ON inventory TO anon;

-- 7. Grant permissions to authenticated role as well (for logged-in users)
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON inventory TO authenticated;

-- ============================================================================
-- VERIFICATION QUERIES (optional - run these to verify setup)
-- ============================================================================

-- Check if inStock column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'instock';

-- Check policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename IN ('products', 'orders', 'inventory');

-- Check permissions
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('products', 'orders', 'inventory')
AND grantee IN ('anon', 'authenticated');

-- Test query (should return products)
SELECT COUNT(*) as total_products FROM products;

-- Test query (should return orders - might be 0 if no orders yet)
SELECT COUNT(*) as total_orders FROM orders;
