# Shree Collection - Cloud Migration Setup Guide

## Quick Summary of Changes

**Category feature**: Removed from all products and UI
**Data persistence**: Now uses Supabase (cloud database) instead of localStorage
**Image storage**: Moved to Supabase Cloud Storage (not localStorage)
**Cross-device sync**: Orders and products now sync automatically across all devices

---

## Manual Setup Steps (You Do This)

### Step 1: Create Supabase Account
1. Go to **https://supabase.com**
2. Click "Start Your Project"
3. Sign up (GitHub or email)

### Step 2: Create Project
1. Create new project named **`shree-collection`**
2. Set region closest to Nepal (e.g., Singapore, Singapore)
3. Set a strong password and note it
4. Wait ~2 minutes for project to initialize

### Step 3: Get API Keys
1. In Supabase dashboard, go to **Settings → API**
2. Copy these two values:
   - **Project URL** (starts with `https://...supabase.co`)
   - **Anon Public Key** (long string starting with `eyJ...`)

### Step 4: Set Up Database Tables
1. In Supabase, go to **SQL Editor**
2. Click **"New Query"**
3. **Paste this entire SQL script** and click "RUN":

```sql
-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  price INT NOT NULL,
  original_price INT,
  description TEXT,
  colors TEXT[],
  sizes TEXT[],
  images TEXT[],
  featured BOOLEAN DEFAULT FALSE,
  in_stock BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  txn TEXT,
  items JSONB NOT NULL,
  total INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create inventory table (optional)
CREATE TABLE IF NOT EXISTS inventory (
  product_id BIGINT PRIMARY KEY,
  quantity INT DEFAULT 0,
  reserved INT DEFAULT 0,
  available INT GENERATED ALWAYS AS (quantity - reserved) STORED,
  last_updated TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "products_read" ON products FOR SELECT USING (true);
CREATE POLICY "orders_create" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_read" ON orders FOR SELECT USING (true);
CREATE POLICY "inventory_read" ON inventory FOR SELECT USING (true);
```

### Step 5: Create Storage Bucket
1. In Supabase, go to **Storage → Buckets**
2. Click **"New Bucket"**
3. Name it: **` `**
4. Uncheck "Private bucket" (make it public)
5. Click **"Create bucket"**

### Step 6: Migrate Existing Products
1. Still in Supabase SQL Editor, create new query
2. **Paste this SQL** to load initial products:

```sql
INSERT INTO products (id, name, price, original_price, description, colors, sizes, images, featured, in_stock)
VALUES
(1, 'Korean Pant', 1400, NULL, 'Comfortable Korean-style pant perfect for casual and semi-formal occasions.', ARRAY['Standard'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800&q=80', 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=800&q=80'], true, true),
(2, 'Paper Plazo', 275, NULL, 'Light and breezy paper plazo ideal for summer and everyday comfort.', ARRAY['Standard'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80', 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80'], false, false),
(3, 'Cord Set', 1250, 1600, 'Stylish coordinated set perfect for parties and special occasions.', ARRAY['Standard'], ARRAY['Free Size', 'Size 4'], ARRAY['https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=800&q=80', 'https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80'], true, true),
(4, 'Designer Suit - Cream', 2100, NULL, 'Elegant cream designer suit with intricate embroidery and premium fabric.', ARRAY['Cream'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80', 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80'], true, true),
(5, 'Baran Pant', 1350, NULL, 'Traditional Baran pant with comfortable fit and elegant design.', ARRAY['Standard'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=800&q=80', 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800&q=80'], false, false),
(6, 'Paper Set', 275, NULL, 'Light paper fabric set for everyday comfort.', ARRAY['Standard'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80', 'https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80'], false, true),
(7, 'Designer Tshirt - Patti', 260, NULL, 'Trendy designer t-shirt with beautiful Patti pattern.', ARRAY['Patti'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80', 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80'], false, true),
(8, 'Ethnic Top', 600, 650, 'Stylish ethnic top perfect for casual and semi-formal wear.', ARRAY['Standard', 'G'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=800&q=80', 'https://images.unsplash.com/photo-1564859228273-274232fdb516?w=800&q=80'], false, true),
(9, 'Traditional Kurta - Pink', 1000, NULL, 'Beautiful traditional kurta in vibrant pink color.', ARRAY['Pink'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80', 'https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80'], false, true),
(10, 'Festive Set', 1500, 1950, 'Complete festive set perfect for celebrations and special occasions.', ARRAY['Standard', 'K'], ARRAY['Free Size', 'Size 1'], ARRAY['https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&q=80', 'https://images.unsplash.com/photo-1595777216742-96069a2c7782?w=800&q=80'], true, true),
(11, 'Kaju Design Set', 1200, NULL, 'Elegant Kaju design set with intricate embroidery work.', ARRAY['Reban'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1614016643991-af6c76573bc4?w=800&q=80', 'https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80'], false, true),
(12, 'Silk Saree', 2000, NULL, 'Premium silk saree with elegant drape and luxurious feel. Perfect for weddings and grand celebrations.', ARRAY['Silk'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80', 'https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80'], true, true),
(13, 'Banmansika Saree', 1550, NULL, 'Beautiful Banmansika saree with traditional patterns and vibrant colors.', ARRAY['Banmansika'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80', 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80'], true, true),
(14, 'Alexa Georgette Saree', 700, NULL, 'Light and flowy Alexa georgette saree perfect for casual and semi-formal occasions.', ARRAY['Alexa'], ARRAY['Georgette'], ARRAY['https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80', 'https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80'], false, true),
(15, 'Khaddi Saree', 1650, NULL, 'Traditional Khaddi saree with rich texture and elegant design.', ARRAY['Khaddi'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80', 'https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80'], false, true),
(16, 'Babli Saree', 2400, NULL, 'Premium Babli saree with intricate work and stunning appeal.', ARRAY['Babli'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80', 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80'], true, true),
(17, 'Sapan Saree', 800, NULL, 'Elegant Sapan saree with beautiful color combinations and comfortable fabric.', ARRAY['Sapan'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80', 'https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80'], false, true),
(18, 'Designer Suit - Mehroon', 1600, NULL, 'Elegant mehroon designer suit with intricate embroidery and premium fabric.', ARRAY['Mehroon'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80', 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80'], false, false),
(19, 'Designer Suit - Pink', 1600, NULL, 'Elegant pink designer suit with intricate embroidery and premium fabric.', ARRAY['Pink'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80', 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80'], false, false),
(20, 'Designer Suit - Rust', 1600, NULL, 'Elegant rust designer suit with intricate embroidery and premium fabric.', ARRAY['Rust'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80', 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80'], false, false),
(21, 'Designer Suit - Reban', 1500, NULL, 'Elegant reban designer suit with intricate embroidery and premium fabric.', ARRAY['Reban'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80', 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80'], false, true),
(22, 'Traditional Kurta - Light Pink', 650, NULL, 'Beautiful traditional kurta in soft light pink color.', ARRAY['Light Pink'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80', 'https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80'], true, true),
(23, 'Traditional Kurta - Dull', 1950, NULL, 'Beautiful traditional kurta in elegant dull shade.', ARRAY['Dull'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80', 'https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80'], false, true),
(24, 'Traditional Kurta - Red', 1850, NULL, 'Beautiful traditional kurta in bold red color.', ARRAY['Red'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80', 'https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80'], false, true),
(25, 'Designer Tshirt - Moti', 270, NULL, 'Trendy designer t-shirt with beautiful Moti pattern.', ARRAY['Moti'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80', 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80'], false, false),
(26, 'Designer Tshirt - Design', 1050, NULL, 'Premium designer t-shirt with intricate design work.', ARRAY['Design'], ARRAY['Free Size'], ARRAY['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80', 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80'], false, true);
```

3. Click **RUN**

### Step 7: Add Environment Variables to Vercel
1. Go to Vercel dashboard → Your project
2. Go to **Settings → Environment Variables**
3. Add two new variables:
   - **Name**: `NEXT_PUBLIC_SUPABASE_URL` | **Value**: (Project URL from Step 3)
   - **Name**: `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Value**: (Anon Public Key from Step 3)
4. Click **Save**

### Step 8: Redeploy to Vercel
1. In Vercel, click **Deployments**
2. Click the three dots on the latest deployment
3. Click **Redeploy** (or push a new commit to trigger auto-deploy)
4. Wait for deployment to complete

---

## Testing Checklist

### On Desktop (Phone A):
- [ ] Open catalog → products load
- [ ] Go to admin → login → edit a product price → save
- [ ] Refresh catalog → new price appears
- [ ] Add product to cart → proceed to checkout → place order

### On Mobile (Phone B):
- [ ] Open same website
- [ ] Refresh catalog → see updated price from Phone A
- [ ] Go to admin → view orders → see order from Phone A

### Image Upload (After Setup):
- [ ] Go to admin → upload an image file
- [ ] Image appears in preview
- [ ] Refresh page → image persists
- [ ] Open on another device → image visible

---

## Troubleshooting

**"Products not loading"**
- Check browser console (F12) for errors
- Verify `NEXT_PUBLIC_SUPABASE_URL` and key are set in Vercel
- Confirm products table exists and has data in Supabase SQL

**"Image upload fails"**
- Check that `product-images` bucket exists and is public
- Verify Supabase credentials are correct
- Try uploading via Supabase UI first to confirm bucket works

**"Orders don't sync"**
- Orders are saved to localStorage immediately (backup)
- Also attempted to sync to Supabase if configured
- Check Supabase orders table to confirm data is there

---

## What Changed

| Feature | Before | After |
|---------|--------|-------|
| Category field | Hardcoded in products | Removed completely |
| Product storage | localStorage (5MB limit) | Supabase database |
| Image storage | localStorage (base64) | Supabase Cloud Storage |
| Orders | localStorage only | Supabase + localStorage backup |
| Device sync | None | Auto-sync across all devices |
| Cross-browser sync | Not possible | Works if using same Supabase |

---

## Files Modified

- `products.js` — Removed category field
- `admin.js` — Updated to use Supabase; removed category form
- `admin.html` — Removed category input field
- `catalog.js` — Removed category filter
- `catalog.html` — Removed category filter UI
- `main.js` — Removed category display
- `cart.js` — Updated order logic
- `db.js` — **NEW** Supabase client & database layer
- Vercel env vars — **ADD** NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

---

## Fallback Behavior

If Supabase is not configured:
- Products load from hardcoded `products.js` array
- Orders save to localStorage only
- Images stored as base64 (5MB limit)
- Everything still works, but no cross-device sync
