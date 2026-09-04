// ==========================================================================
// SUPABASE DATABASE CLIENT
// ==========================================================================
// READ paths use the anon key directly (subject to RLS).
// ADMIN WRITE paths (update/delete product, change order status, upload
// image) MUST go through /api/admin/* serverless functions using a session
// token. This file exposes helper wrappers that the admin page calls.
// The storefront checkout still uses createOrder() via the anon key, which
// is the one write we allow anon to perform.
// ==========================================================================

const SUPABASE_URL = window.SUPABASE_CONFIG?.url || '';
const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.anonKey || '';

let supabaseClient = null;
let supabaseReady = false;

function initSupabase() {
    if (typeof supabase === 'undefined') {
        console.error('Supabase library not loaded.');
        return false;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('Supabase credentials not configured.');
        return false;
    }
    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabaseReady = true;
        return true;
    } catch (err) {
        console.error('Failed to initialize Supabase:', err);
        return false;
    }
}

function isSupabaseReady() {
    return supabaseReady && supabaseClient !== null;
}

function showSupabaseError() {
    if (typeof showToast === 'function') {
        showToast('Database connection failed. Please refresh and try again.', 'error');
    }
    console.error('Supabase not configured. Business data requires cloud database.');
}

// ==========================================================================
// ADMIN SESSION
// ==========================================================================
// The admin page stores a bearer token from /api/login. Helpers below wrap
// every admin write so the token flows through automatically. If no token is
// present, the call fails fast — anonymous browsers cannot mutate the
// database directly.

function getAdminToken() {
    try { return sessionStorage.getItem('shree_admin_token') || ''; } catch { return ''; }
}

function setAdminToken(token) {
    try {
        if (token) sessionStorage.setItem('shree_admin_token', token);
        else sessionStorage.removeItem('shree_admin_token');
    } catch {}
}

async function adminFetch(path, init = {}) {
    const token = getAdminToken();
    if (!token) {
        throw new Error('No admin session token. Please log in again.');
    }
    const headers = {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        'Authorization': `Bearer ${token}`,
    };
    const resp = await fetch(`/api/admin/${path}`, { ...init, headers });
    let data = null;
    const text = await resp.text();
    if (text) {
        try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!resp.ok) {
        const err = new Error((data && data.error) || `HTTP ${resp.status}`);
        err.status = resp.status;
        err.payload = data;
        throw err;
    }
    return data;
}

// ==========================================================================
// PRODUCTS — anon reads only. Admin writes via /api/admin/products.
// ==========================================================================

let productsCache = null;
let productsCacheTTL = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getProducts(bypassCache = false) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return [];
    }
    const now = Date.now();
    if (!bypassCache && productsCache && now < productsCacheTTL) {
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
        console.error('Error fetching products:', err);
        showSupabaseError();
        return [];
    }
}

async function getProductById(productId) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return null;
    }
    try {
        const { data, error } = await supabaseClient
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();
        if (error) throw error;
        return data || null;
    } catch (err) {
        console.error('Error fetching product by ID:', err);
        return null;
    }
}

async function getFeaturedProducts() {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return [];
    }
    try {
        const { data, error } = await supabaseClient
            .from('products')
            .select('*')
            .eq('featured', true)
            .order('id', { ascending: true });
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Error fetching featured products:', err);
        return [];
    }
}

// --- Admin wrappers (require admin session) ---

async function adminListProducts(opts = {}) {
    const qs = new URLSearchParams();
    if (opts.search) qs.set('search', opts.search);
    if (opts.in_stock !== undefined) qs.set('in_stock', String(opts.in_stock));
    if (opts.featured !== undefined) qs.set('featured', String(opts.featured));
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.pageSize) qs.set('pageSize', String(opts.pageSize));
    return adminFetch(`products?${qs.toString()}`);
}

async function adminUpdateProduct(id, fields) {
    return adminFetch('products', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...fields }),
    });
}

async function adminCreateProduct(fields) {
    return adminFetch('products', {
        method: 'POST',
        body: JSON.stringify(fields),
    });
}

async function adminDeleteProduct(id) {
    return adminFetch('products', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
    });
}

async function adminUploadImage({ filename, contentType, base64 }) {
    return adminFetch('upload-image', {
        method: 'POST',
        body: JSON.stringify({ filename, contentType, base64 }),
    });
}

// --- Legacy anon-write functions, kept as no-op stubs so the storefront
// checkout still works. Admin code should use the admin* wrappers above. ---

async function addProduct() {
    console.warn('addProduct is admin-only. Use adminCreateProduct().');
    return null;
}
async function updateProduct() {
    console.warn('updateProduct is admin-only. Use adminUpdateProduct().');
    return null;
}
async function deleteProduct() {
    console.warn('deleteProduct is admin-only. Use adminDeleteProduct().');
    return false;
}

// ==========================================================================
// INVENTORY — read-only via anon is RLS-blocked. Admin uses service role
// indirectly through /api/admin/* if needed in the future.
// ==========================================================================

async function getInventory() {
    // Inventory table is not readable by anon. Return null so the storefront
    // falls back to product.in_stock (the boolean we already show on cards).
    return null;
}

async function updateInventory() {
    console.warn('updateInventory must be done via /api/admin/* (not yet exposed).');
    return false;
}

// ==========================================================================
// ORDERS — storefront CREATE only. Admin reads/updates via /api/admin/orders.
// ==========================================================================

async function getOrders() {
    // Read goes through the admin API so it sees the full row including
    // the new status column (which we add in 001_admin_columns.sql).
    try {
        const data = await adminFetch('orders?pageSize=200');
        return data.orders || [];
    } catch (e) {
        // No admin session (e.g. visitor hit a stale page) — fall back to anon
        if (!isSupabaseReady()) return [];
        try {
            const { data, error } = await supabaseClient
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('Error fetching orders:', err);
            return [];
        }
    }
}

async function adminListOrders(opts = {}) {
    const qs = new URLSearchParams();
    if (opts.search) qs.set('search', opts.search);
    if (opts.status) qs.set('status', opts.status);
    if (opts.payment_status) qs.set('payment_status', opts.payment_status);
    if (opts.payment_method) qs.set('payment_method', opts.payment_method);
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.pageSize) qs.set('pageSize', String(opts.pageSize));
    return adminFetch(`orders?${qs.toString()}`);
}

async function adminGetOrder(orderId) {
    return adminFetch(`orders?order_id=${encodeURIComponent(orderId)}`);
}

async function adminUpdateOrderStatus(orderId, status, extras = {}) {
    return adminFetch('orders', {
        method: 'PATCH',
        body: JSON.stringify({ order_id: orderId, status, ...extras }),
    });
}

async function adminUpdateOrderPayment(orderId, payment_status, extras = {}) {
    return adminFetch('orders', {
        method: 'PATCH',
        body: JSON.stringify({ order_id: orderId, payment_status, ...extras }),
    });
}

async function adminCancelOrder(orderId) {
    return adminFetch('orders', {
        method: 'DELETE',
        body: JSON.stringify({ order_id: orderId }),
    });
}

// --- Storefront order creation (the only anon write the storefront does) ---

async function createOrder(orderData) {
    if (!isSupabaseReady()) {
        showSupabaseError();
        return false;
    }
    try {
        const payload = {
            order_id: orderData.orderId,
            name: orderData.name,
            phone: orderData.phone,
            city: orderData.city,
            address: orderData.address,
            txn: orderData.txn,
            items: orderData.items,
            total: orderData.total,
        };
        // Persist payment_method if provided (the new column is optional in payload)
        if (orderData.paymentMethod) payload.payment_method = orderData.paymentMethod;
        if (orderData.paymentStatus) payload.payment_status = orderData.paymentStatus;

        const { error } = await supabaseClient.from('orders').insert([payload]);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Error creating order:', err);
        showSupabaseError();
        return false;
    }
}

async function getOrderById(orderId) {
    // Public lookup only — for checkout success page. Uses anon key.
    if (!isSupabaseReady()) return null;
    try {
        const { data, error } = await supabaseClient
            .from('orders')
            .select('*')
            .eq('order_id', orderId)
            .single();
        if (error) return null;
        return data;
    } catch (err) {
        return null;
    }
}

// Legacy wrapper used by cart.js confirmEsewaPayment. In the secure
// architecture, customers don't have admin tokens — so the customer-side
// "I have paid" click is purely UX (clears local pending order, shows the
// success page). The actual payment_status flip happens in the admin
// dashboard after the merchant confirms the eSewa transfer out of band.
async function updateOrderStatus(orderId, status, paymentMethod) {
    if (!getAdminToken()) {
        // No admin session — customer flow, nothing to do server-side.
        return true;
    }
    try {
        const extras = paymentMethod ? { payment_method: paymentMethod } : {};
        return await adminUpdateOrderStatus(orderId, status, extras);
    } catch (e) {
        console.error('updateOrderStatus failed:', e);
        return false;
    }
}

// ==========================================================================
// IMAGE UPLOAD — admin only via /api/admin/upload-image
// ==========================================================================

async function uploadImage(file) {
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error || new Error('FileReader failed'));
            r.readAsDataURL(file);
        });
        const commaIdx = String(dataUrl).indexOf(',');
        const header = String(dataUrl).slice(0, commaIdx);
        const base64 = String(dataUrl).slice(commaIdx + 1);
        const m = /^data:([^;]+);base64$/.exec(header);
        const contentType = m ? m[1] : (file.type || 'image/jpeg');

        const result = await adminUploadImage({ filename: file.name, contentType, base64 });
        return { url: result.url, error: null };
    } catch (err) {
        return { url: null, error: err.message || String(err) };
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
