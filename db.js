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

// Change the admin password. Sends the three required fields and returns
// { success, token, message }. The response includes a fresh session
// token signed with the (preserved) session secret, so the caller can
// swap it into sessionStorage and avoid a forced re-login.
async function adminChangePassword({ currentPassword, newPassword, confirmPassword }) {
    return adminFetch('change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
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

// --- Storefront order creation ---
// As of the payment/order hardening pass, the storefront no longer writes
// directly to Supabase. All order creation, eSewa transaction reference
// submission, and public order lookup goes through /api/orders, which runs
// on the server with the service role key and re-validates the cart
// (price, total, stock) before persisting anything. This wrapper is the
// thin client-side caller for that endpoint.

async function callOrdersApi(path, init = {}) {
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    // Join with a single slash; if path is empty, do NOT add a trailing slash
    // (Vercel normalises /api/orders/ to /api/orders, but a separate fetch
    // to /api/orders/ would 405 because the route is the bare /api/orders).
    const url = path ? `/api/orders/${path}` : '/api/orders';
    const resp = await fetch(url, { ...init, headers });
    let data = null;
    const text = await resp.text();
    if (text) {
        try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!resp.ok) {
        const err = new Error((data && data.error) || `HTTP ${resp.status}`);
        err.status = resp.status;
        err.payload = data;
        err.userMessage = (data && data.error) || 'Could not place your order. Please try again.';
        throw err;
    }
    return data;
}

// createOrder is called by cart.js submitOrder(). It used to do a direct
// anon-key insert with a browser-supplied total - that path is closed.
// The server is now the only authority on price, stock, and total.
async function createOrder(orderData) {
    try {
        const result = await callOrdersApi('', {
            method: 'POST',
            body: JSON.stringify({
                name: orderData.name,
                phone: orderData.phone,
                city: orderData.city,
                address: orderData.address,
                items: orderData.items,
                total: orderData.total,         // advisory; server recomputes
                paymentMethod: orderData.paymentMethod,
                txn: orderData.txn,
            }),
        });
        return {
            ok: true,
            orderId: result.order_id,
            total: result.total,
            paymentStatus: result.payment_status,
            status: result.status,
            clientTotalMismatch: !!result.client_total_mismatch,
        };
    } catch (err) {
        console.error('createOrder failed:', err);
        if (typeof showToast === 'function') {
            showToast(err.userMessage || 'Could not place your order. Please try again.', 'error');
        }
        return { ok: false, error: err.userMessage || err.message, status: err.status, payload: err.payload };
    }
}

async function getOrderById(orderId) {
    // Public lookup is intentionally not available without a phone match.
    // The success page uses lookupOrder({ orderId, phone }) for a soft
    // authenticated read. Existing admin code paths should use
    // adminGetOrder() instead. This stub returns null so a stray caller
    // is forced to be explicit about what it is doing.
    return null;
}

// submitEsewaTransaction is called by cart.js after the customer has
// paid via the personal eSewa QR and typed in their transaction
// reference. It calls the public PATCH-style POST /api/orders/txn
// endpoint, which soft-authenticates on (orderId, last-10-digits-of-phone)
// and refuses to attach a txn to an order that has already been paid
// or failed. payment_status stays 'pending' here — only the admin
// "Verify Payment" action flips it to 'paid'.
async function submitEsewaTransaction({ orderId, phone, txn }) {
    try {
        const result = await callOrdersApi('txn', {
            method: 'POST',
            body: JSON.stringify({ order_id: orderId, phone, txn }),
        });
        return { ok: true, paymentStatus: result.payment_status, txn: result.txn };
    } catch (err) {
        console.error('submitEsewaTransaction failed:', err);
        if (typeof showToast === 'function') {
            showToast(err.userMessage || 'Could not save your transaction reference.', 'error');
        }
        return { ok: false, error: err.userMessage || err.message, status: err.status, payload: err.payload };
    }
}

// lookupOrder is called by checkout-success.html. It takes both the
// orderId and the customer's phone, soft-matches on the phone's last 10
// digits server-side, and returns a sanitized order view. The phone is
// saved in localStorage by handleCheckoutSubmit just before redirect,
// so the success page has both pieces.
async function lookupOrder({ orderId, phone }) {
    try {
        const qs = new URLSearchParams({ order_id: orderId, phone });
        const result = await callOrdersApi(`lookup?${qs.toString()}`, { method: 'GET' });
        return { ok: true, order: result };
    } catch (err) {
        console.error('lookupOrder failed:', err);
        return { ok: false, error: err.userMessage || err.message, status: err.status, payload: err.payload };
    }
}

// Legacy wrapper removed. In the secure architecture, the customer-side
// eSewa submission goes through submitEsewaTransaction() (which calls
// the public /api/orders/txn endpoint with a soft phone match). The
// payment_status flip from pending -> paid happens only via the admin
// "Verify Payment" action on /api/admin/orders/verify, never from a
// browser-side call.

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
