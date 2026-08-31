// ==========================================================================
// SUPABASE DATABASE CLIENT
// ==========================================================================
// Supabase is the ONLY source of truth for business data.
// No fallback to localStorage for products, inventory, or orders.
// Errors are explicit - no silent degradation.

const SUPABASE_URL = window.SUPABASE_CONFIG?.url || '';
const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.anonKey || '';

let supabaseClient = null;
let supabaseReady = false;

// Initialize Supabase client (loaded via CDN in HTML)
function initSupabase() {
    if (typeof supabase === 'undefined') {
        console.error('❌ Supabase library not loaded.');
        return false;
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('❌ Supabase credentials not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.');
        return false;
    }

    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabaseReady = true;
        console.log('✓ Supabase initialized');
        return true;
    } catch (err) {
        console.error('❌ Failed to initialize Supabase:', err);
        return false;
    }
}

function isSupabaseReady() {
    return supabaseReady && supabaseClient !== null;
}

function showSupabaseError() {
    showToast('❌ Database connection failed. Please refresh and try again.');
    console.error('Supabase not configured. Business data requires cloud database.');
}

// ==========================================================================
// PRODUCTS - Supabase only
// ==========================================================================

let productsCache = null;
let productsCacheTTL = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getProducts() {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return [];
    }

    const now = Date.now();
    if (productsCache && now < productsCacheTTL) {
        return productsCache;
    }

    try {
        const { data, error } = await supabaseClient
            .from('products')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;

        productsCache = data || [];
        productsCacheTTL = now + CACHE_DURATION;
        return productsCache;
    } catch (err) {
        console.error('❌ Error fetching products:', err);
        showSupabaseError();
        return [];
    }
}

async function addProduct(productData) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return null;
    }

    try {
        const { data, error } = await supabaseClient
            .from('products')
            .insert([productData])
            .select();

        if (error) throw error;
        productsCacheTTL = 0; // Invalidate cache
        return data?.[0] || null;
    } catch (err) {
        console.error('❌ Error adding product:', err);
        showSupabaseError();
        return null;
    }
}

async function updateProduct(productId, updates) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return null;
    }

    try {
        const { data, error } = await supabaseClient
            .from('products')
            .update(updates)
            .eq('id', productId)
            .select();

        if (error) throw error;
        productsCacheTTL = 0; // Invalidate cache
        return data?.[0] || null;
    } catch (err) {
        console.error('❌ Error updating product:', err);
        showSupabaseError();
        return null;
    }
}

async function deleteProduct(productId) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return false;
    }

    try {
        const { error } = await supabaseClient
            .from('products')
            .delete()
            .eq('id', productId);

        if (error) throw error;
        productsCacheTTL = 0; // Invalidate cache
        return true;
    } catch (err) {
        console.error('❌ Error deleting product:', err);
        showSupabaseError();
        return false;
    }
}

// ==========================================================================
// INVENTORY - Supabase only
// ==========================================================================

async function getInventory(productId) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return null;
    }

    try {
        const { data, error } = await supabaseClient
            .from('inventory')
            .select('*')
            .eq('product_id', productId)
            .single();

        if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
        return data || null;
    } catch (err) {
        console.error('❌ Error fetching inventory:', err);
        showSupabaseError();
        return null;
    }
}

async function updateInventory(productId, quantity) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return false;
    }

    try {
        const { error } = await supabaseClient
            .from('inventory')
            .upsert({ product_id: productId, quantity })
            .eq('product_id', productId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('❌ Error updating inventory:', err);
        showSupabaseError();
        return false;
    }
}

// ==========================================================================
// ORDERS - Supabase only (no localStorage fallback)
// ==========================================================================

async function getOrders() {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return [];
    }

    try {
        const { data, error } = await supabaseClient
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('❌ Error fetching orders:', err);
        showSupabaseError();
        return [];
    }
}

async function createOrder(orderData) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return false;
    }

    try {
        const { error } = await supabaseClient
            .from('orders')
            .insert([{
                order_id: orderData.orderId,
                name: orderData.name,
                phone: orderData.phone,
                city: orderData.city,
                address: orderData.address,
                txn: orderData.txn,
                items: orderData.items,
                total: orderData.total
            }]);

        if (error) throw error;
        console.log('✓ Order saved to Supabase');
        return true;
    } catch (err) {
        console.error('❌ Error creating order:', err);
        showSupabaseError();
        return false;
    }
}

// ==========================================================================
// IMAGE UPLOAD - Supabase Storage only
// ==========================================================================

async function uploadImage(file) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return null;
    }

    try {
        const randomStr = Math.random().toString(36).substring(2, 11);
        const fileName = `${Date.now()}-${randomStr}-${file.name}`;

        const { error } = await supabaseClient.storage
            .from('product-images')
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        const { data: publicUrl } = supabaseClient.storage
            .from('product-images')
            .getPublicUrl(fileName);

        return publicUrl.publicUrl || null;
    } catch (err) {
        console.error('❌ Error uploading image:', err);
        showSupabaseError();
        return null;
    }
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
});

function initDBConnection() {
    return initSupabase();
}

