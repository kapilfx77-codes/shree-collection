// ==========================================================================
// SHREE COLLECTION — ADMIN DASHBOARD
// ==========================================================================
// All writes go through /api/admin/* (service role). Reads on the public
// tables (products, orders) go through the same admin API so the browser
// never hits Supabase directly with the anon key for sensitive data.
//
// If the SQL migration (sql/001_admin_columns.sql) hasn't been run yet,
// API calls for the orders.status / payment_method / payment_status columns
// will 400. We surface that as a friendly banner so the admin knows what to
// do, instead of pretending data is missing.
// ==========================================================================

let currentPage = 'dashboard';
let productsCacheList = [];
let ordersCacheList = [];
let customersCacheList = [];

// Local edit-state
let editingProductId = null;
let uploadedImages = [];   // File objects waiting to upload
let existingImages = [];   // already-uploaded URLs (for edit mode)
let orderStatusFilter = 'all';
let productFilter = 'all';
let orderSearchText = '';
let productSearchText = '';
let customerSearchText = '';

const PLACEHOLDER_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 100"><rect width="80" height="100" fill="%23F0EBE4"/><text x="40" y="52" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="%238B7D6B">No image</text></svg>';

document.addEventListener('DOMContentLoaded', () => {
    if (typeof initDBConnection === 'function') initDBConnection();
    setupAuth();
    setupNav();
    setupSearches();
    setupTopbar();
    setupProductModal();
    setupSettings();
    setupMobileMenu();
});

// ==========================================================================
// AUTH
// ==========================================================================

function setupAuth() {
    if (typeof sessionStorage === 'undefined') return;
    const authed = sessionStorage.getItem('shree_admin_auth') === 'true'
        && getAdminToken();
    if (authed) {
        showApp();
    } else {
        showLogin();
    }

    const form = document.getElementById('adminLoginForm');
    if (form) form.addEventListener('submit', handleAdminLogin);
}

function showLogin() {
    document.getElementById('adminLoginModal').style.display = 'flex';
    document.getElementById('adminShell').style.display = 'none';
}

function showApp() {
    document.getElementById('adminLoginModal').style.display = 'none';
    document.getElementById('adminShell').style.display = 'grid';
    routeToPage('dashboard');
    loadPageData('dashboard');
}

async function handleAdminLogin(e) {
    e.preventDefault();
    const pwd = document.getElementById('adminPasswordInput').value;
    const err = document.getElementById('loginErrorMsg');
    err.style.display = 'none';

    try {
        const resp = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd }),
        });
        const data = await resp.json();
        if (resp.ok && data.success && data.token) {
            sessionStorage.setItem('shree_admin_auth', 'true');
            setAdminToken(data.token);
            showApp();
            return;
        }
        err.textContent = (data && data.error) || 'Incorrect password.';
        err.style.display = 'block';
    } catch (ex) {
        err.textContent = 'Login service unavailable. Check your connection.';
        err.style.display = 'block';
    }
}

function handleAdminLogout() {
    sessionStorage.removeItem('shree_admin_auth');
    setAdminToken('');
    window.location.reload();
}

// ==========================================================================
// NAVIGATION
// ==========================================================================

function setupNav() {
    document.querySelectorAll('#adminNav a[data-page]').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const page = a.dataset.page;
            routeToPage(page);
            loadPageData(page);
            // close mobile drawer
            document.getElementById('adminSidebar').classList.remove('open');
        });
    });

    // Jump links inside cards (e.g. "View all →")
    document.querySelectorAll('[data-jump]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const page = el.dataset.jump;
            routeToPage(page);
            loadPageData(page);
        });
    });

    const refreshBtn = document.getElementById('refreshDashboard');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadPageData('dashboard'));
}

function setupTopbar() {
    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (confirm('Log out from the admin dashboard?')) handleAdminLogout();
    });
}

function setupMobileMenu() {
    const toggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('adminSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!toggle) return;
    const setOpen = (open) => {
        sidebar.classList.toggle('open', open);
        if (backdrop) backdrop.classList.toggle('open', open);
    };
    toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
    if (backdrop) backdrop.addEventListener('click', () => setOpen(false));
    // Close drawer when a nav link is tapped on mobile
    sidebar.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            if (window.innerWidth <= 960) setOpen(false);
        });
    });
}

function routeToPage(page) {
    currentPage = page;
    document.querySelectorAll('#adminNav a').forEach(a => {
        a.classList.toggle('active', a.dataset.page === page);
    });
    document.querySelectorAll('.admin-page').forEach(p => {
        p.classList.toggle('active', p.dataset.page === page);
    });
    const titleMap = {
        dashboard: 'Dashboard',
        orders: 'Orders',
        products: 'Products',
        inventory: 'Inventory',
        customers: 'Customers',
        settings: 'Settings',
    };
    const t = document.getElementById('topbarTitle');
    if (t) t.textContent = titleMap[page] || 'Admin';
}

function setupSearches() {
    // Order search — Enter to filter (live as well, debounced)
    const oSearch = document.getElementById('orderSearch');
    oSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); }
    });
    oSearch.addEventListener('input', debounce(() => {
        orderSearchText = oSearch.value.trim();
        renderOrders();
    }, 250));

    // Order status pills
    document.getElementById('orderStatusFilter').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        orderStatusFilter = btn.dataset.filter;
        document.querySelectorAll('#orderStatusFilter .filter-pill').forEach(p => {
            p.classList.toggle('active', p === btn);
        });
        renderOrders();
    });

    // Product search
    const pSearch = document.getElementById('productSearch');
    pSearch.addEventListener('input', debounce(() => {
        productSearchText = pSearch.value.trim();
        renderProducts();
    }, 250));

    // Product pills
    document.getElementById('productFilter').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        productFilter = btn.dataset.filter;
        document.querySelectorAll('#productFilter .filter-pill').forEach(p => {
            p.classList.toggle('active', p === btn);
        });
        renderProducts();
    });

    // Customer search
    const cSearch = document.getElementById('customerSearch');
    cSearch.addEventListener('input', debounce(() => {
        customerSearchText = cSearch.value.trim();
        renderCustomers();
    }, 250));
}

// ==========================================================================
// SETTINGS — change admin password
// ==========================================================================
//
// The Settings page is purely a password-change form. The submit handler
// posts to /api/admin/change-password via the adminChangePassword helper
// (db.js) which carries the admin bearer token. On success, the response
// includes a fresh session token; we replace the existing sessionStorage
// token with it and clear the form. On failure we surface the server's
// error message inline. We never log, print, or echo the new password.

function setupSettings() {
    const form = document.getElementById('changePasswordForm');
    if (!form) return;
    form.addEventListener('submit', handleChangePasswordSubmit);
    const cancel = document.getElementById('cpCancel');
    if (cancel) cancel.addEventListener('click', clearChangePasswordForm);
    // Live-clear the inline error when the user types again.
    ['cpCurrent', 'cpNew', 'cpConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            const err = document.getElementById('cpError');
            if (err) err.hidden = true;
        });
    });
}

function loadSettings() {
    // Reset the page state every time the user navigates to Settings so a
    // stale "Password changed" banner doesn't linger between visits.
    clearChangePasswordForm();
    const banner = document.getElementById('settingsSecurityStatus');
    if (banner) banner.hidden = true;
}

function clearChangePasswordForm() {
    const form = document.getElementById('changePasswordForm');
    if (form) form.reset();
    const err = document.getElementById('cpError');
    if (err) { err.hidden = true; err.textContent = ''; }
    const hint = document.getElementById('cpHint');
    if (hint) hint.textContent = '';
}

function showChangePasswordError(message) {
    const err = document.getElementById('cpError');
    if (!err) return;
    err.textContent = message;
    err.hidden = false;
}

async function handleChangePasswordSubmit(e) {
    e.preventDefault();

    const currentPassword = document.getElementById('cpCurrent').value;
    const newPassword     = document.getElementById('cpNew').value;
    const confirmPassword = document.getElementById('cpConfirm').value;

    // ---- Client-side validation (server re-validates; this is a UX guard) ----
    if (!currentPassword || !newPassword || !confirmPassword) {
        showChangePasswordError('Please fill in all three fields.');
        return;
    }
    if (newPassword.length < 12) {
        showChangePasswordError('New password must be at least 12 characters.');
        return;
    }
    if (newPassword !== confirmPassword) {
        showChangePasswordError('New password and confirmation do not match.');
        return;
    }
    if (newPassword === currentPassword) {
        showChangePasswordError('New password must be different from the current password.');
        return;
    }

    const btn = document.getElementById('cpSubmit');
    const hint = document.getElementById('cpHint');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    if (hint) hint.textContent = '';

    try {
        const res = await adminChangePassword({ currentPassword, newPassword, confirmPassword });
        if (res && res.success && res.token) {
            // Replace the session token so subsequent API calls use the
            // refreshed credential. The server preserved the session
            // secret, so other admin sessions on other devices remain
            // valid (per product decision: don't rotate on change).
            setAdminToken(res.token);
            sessionStorage.setItem('shree_admin_auth', 'true');
            clearChangePasswordForm();
            // Refocus the first empty field so keyboard users can keep going.
            const first = document.getElementById('cpCurrent');
            if (first) first.focus();
            const banner = document.getElementById('settingsSecurityStatus');
            if (banner) {
                banner.textContent = 'Password changed successfully. Use the new password next time you sign in.';
                banner.className = 'settings-banner ok';
                banner.hidden = false;
            }
            if (hint) hint.textContent = 'Done.';
            showToast('Password changed', 'success');
        } else {
            const msg = (res && res.error) || 'Failed to change password.';
            showChangePasswordError(msg);
        }
    } catch (err) {
        // err.status === 401 means the session expired (token rejected).
        // Anything else is a network/server error.
        if (err && err.status === 401) {
            showApiError(err); // 401 handler in showApiError will reload to re-login
        } else {
            showChangePasswordError((err && err.message) || 'Server error. Try again.');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Change password';
    }
}



// ==========================================================================
// DATA LOADING
// ==========================================================================

async function loadPageData(page) {
    try {
        if (page === 'dashboard') await loadDashboard();
        else if (page === 'orders') await loadOrders();
        else if (page === 'products') await loadProducts();
        else if (page === 'inventory') await loadInventory();
        else if (page === 'customers') await loadCustomers();
        else if (page === 'settings') loadSettings();
    } catch (err) {
        console.error(`loadPageData(${page}) failed:`, err);
        showApiError(err);
    }
}

async function loadDashboard() {
    document.getElementById('dashStats').innerHTML = '<div class="state-block" style="grid-column: 1/-1;"><div class="spinner"></div><p class="state-title" style="margin-top: 12px;">Loading dashboard…</p></div>';

    // Fetch products + orders in parallel
    const [products, orders] = await Promise.all([
        adminListProducts({ pageSize: 500 }).catch(() => ({ products: [] })),
        adminListOrders({ pageSize: 500 }).catch(() => ({ orders: [] })),
    ]);
    productsCacheList = products.products || [];
    ordersCacheList = orders.orders || [];

    renderDashStats(productsCacheList, ordersCacheList);
    renderDashRecentOrders(ordersCacheList);
    renderDashLowStock(productsCacheList);
    renderDashStatusBreakdown(ordersCacheList);
}

async function loadOrders() {
    document.getElementById('ordersList').innerHTML = '<div class="state-block" style="padding: 60px;"><div class="spinner"></div></div>';
    const res = await adminListOrders({ pageSize: 500 });
    ordersCacheList = res.orders || [];
    renderOrders();
}

async function loadProducts() {
    document.getElementById('productsList').innerHTML = '<div class="state-block" style="padding: 60px;"><div class="spinner"></div></div>';
    const res = await adminListProducts({ pageSize: 500 });
    productsCacheList = res.products || [];
    renderProducts();
}

async function loadInventory() {
    document.getElementById('inventoryList').innerHTML = '<div class="state-block" style="padding: 60px;"><div class="spinner"></div></div>';
    const res = await adminListProducts({ pageSize: 500 });
    productsCacheList = res.products || [];
    renderInventory();
}

async function loadCustomers() {
    document.getElementById('customersList').innerHTML = '<div class="state-block" style="padding: 60px;"><div class="spinner"></div></div>';
    const res = await adminListOrders({ pageSize: 500 });
    ordersCacheList = res.orders || [];
    customersCacheList = deriveCustomers(ordersCacheList);
    renderCustomers();
}

// ==========================================================================
// DASHBOARD RENDER
// ==========================================================================

function renderDashStats(products, orders) {
    const totalSales = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const inStock = products.filter(p => isInStock(p)).length;
    const outOfStock = products.length - inStock;

    // Last 7 days sales
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentOrders = orders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return t >= sevenDaysAgo;
    });
    const recentSales = recentOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);

    // Pending orders (status column may not exist yet — guard)
    const pending = orders.filter(o => !o.status || o.status === 'pending').length;

    const html = `
        <div class="stat-card">
            <div class="stat-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div class="stat-label">Total Sales</div>
            <div class="stat-value">NPR ${totalSales.toLocaleString('en-IN')}</div>
            <div class="stat-meta">${orders.length} order${orders.length === 1 ? '' : 's'} all-time</div>
        </div>
        <div class="stat-card">
            <div class="stat-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div class="stat-label">Last 7 Days</div>
            <div class="stat-value">NPR ${recentSales.toLocaleString('en-IN')}</div>
            <div class="stat-meta">${recentOrders.length} order${recentOrders.length === 1 ? '' : 's'} this week</div>
        </div>
        <div class="stat-card">
            <div class="stat-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            </div>
            <div class="stat-label">Pending Orders</div>
            <div class="stat-value">${pending}</div>
            <div class="stat-meta">${pending === 0 && orders.length > 0 ? 'All caught up!' : 'Awaiting fulfillment'}</div>
        </div>
        <div class="stat-card">
            <div class="stat-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
            </div>
            <div class="stat-label">Products</div>
            <div class="stat-value">${products.length}</div>
            <div class="stat-meta">
                <span style="color:#047857">${inStock} in stock</span>
                ${outOfStock > 0 ? `<span style="color:#B91C1C; margin-left: 8px;">${outOfStock} out</span>` : ''}
            </div>
        </div>
    `;
    document.getElementById('dashStats').innerHTML = html;
}

function renderDashRecentOrders(orders) {
    const target = document.getElementById('dashRecentOrders');
    if (orders.length === 0) {
        target.innerHTML = renderEmptyState(
            'No orders yet',
            'New orders will appear here as customers complete checkout.'
        );
        return;
    }
    const recent = orders.slice(0, 5);
    target.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th style="text-align: right;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${recent.map(o => `
                    <tr style="cursor: pointer;" onclick="openOrderModal('${escapeHtml(o.order_id)}')">
                        <td><code style="font-size: 0.82rem; color: var(--text-dark);">${escapeHtml(o.order_id)}</code></td>
                        <td>${escapeHtml(o.name || '—')}</td>
                        <td>${statusBadge(o.status)}</td>
                        <td class="col-num" style="text-align: right; font-weight: 600;">NPR ${Number(o.total || 0).toLocaleString('en-IN')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderDashLowStock(products) {
    const target = document.getElementById('dashLowStock');
    const outOfStock = products.filter(p => !isInStock(p));
    if (products.length === 0) {
        target.innerHTML = renderEmptyState('No products', 'Add products to see stock alerts.');
        return;
    }
    if (outOfStock.length === 0) {
        target.innerHTML = `
            <div class="state-block" style="padding: 30px;">
                <div class="state-icon">✓</div>
                <div class="state-title" style="color: #047857;">All products in stock</div>
                <div class="state-detail">${products.length} product${products.length === 1 ? '' : 's'} available</div>
            </div>
        `;
        return;
    }
    target.innerHTML = outOfStock.slice(0, 5).map(p => `
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle);">
            <img src="${(p.images && p.images[0]) || PLACEHOLDER_IMAGE}" alt="" style="width: 36px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.name)}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">NPR ${Number(p.price || 0).toLocaleString('en-IN')}</div>
            </div>
            <span class="badge badge-red">Out</span>
        </div>
    `).join('');
}

function renderDashStatusBreakdown(orders) {
    const target = document.getElementById('dashStatusBreakdown');
    if (orders.length === 0) {
        target.innerHTML = '<div class="state-block"><div class="state-title">No order data yet</div></div>';
        return;
    }
    // Last 30 days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = orders.filter(o => new Date(o.created_at).getTime() >= thirtyDaysAgo);

    const buckets = { pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
    recent.forEach(o => {
        const s = o.status || 'pending';
        if (s in buckets) buckets[s]++;
    });
    const total = recent.length || 1;
    const max = Math.max(...Object.values(buckets), 1);

    target.innerHTML = `
        <div style="display: grid; gap: 12px;">
            ${Object.entries(buckets).map(([status, count]) => {
                const pct = Math.round((count / total) * 100);
                const barWidth = Math.round((count / max) * 100);
                return `
                    <div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
                            <span>${statusBadge(status)}</span>
                            <span style="color: var(--text-muted);">${count} (${pct}%)</span>
                        </div>
                        <div style="height: 8px; background: var(--bg-subtle); border-radius: 999px; overflow: hidden;">
                            <div style="height: 100%; background: ${statusColor(status)}; width: ${barWidth}%; transition: width 0.3s;"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ==========================================================================
// ORDERS RENDER + ACTIONS
// ==========================================================================

function renderOrders() {
    const target = document.getElementById('ordersList');
    if (ordersCacheList.length === 0) {
        target.innerHTML = renderEmptyState(
            'No orders yet',
            'When customers complete checkout, orders will appear here.'
        );
        return;
    }
    let list = ordersCacheList;
    if (orderStatusFilter !== 'all') {
        list = list.filter(o => (o.status || 'pending') === orderStatusFilter);
    }
    if (orderSearchText) {
        const q = orderSearchText.toLowerCase();
        list = list.filter(o =>
            (o.order_id || '').toLowerCase().includes(q) ||
            (o.name || '').toLowerCase().includes(q) ||
            (o.phone || '').toLowerCase().includes(q) ||
            (o.city || '').toLowerCase().includes(q)
        );
    }
    if (list.length === 0) {
        target.innerHTML = renderEmptyState(
            'No matching orders',
            'Try a different filter or search term.'
        );
        return;
    }
    target.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th style="text-align: right;">Total</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${list.map(o => `
                    <tr>
                        <td><code style="font-size: 0.82rem;">${escapeHtml(o.order_id)}</code></td>
                        <td style="font-size: 0.85rem; color: var(--text-muted);">${formatDate(o.created_at)}</td>
                        <td>
                            <div style="font-weight: 600;">${escapeHtml(o.name || '—')}</div>
                            <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(o.phone || '')} · ${escapeHtml(o.city || '')}</div>
                        </td>
                        <td>${paymentBadge(o.payment_status, o.payment_method)}</td>
                        <td>${statusBadge(o.status)}</td>
                        <td class="col-num" style="text-align: right; font-weight: 600;">NPR ${Number(o.total || 0).toLocaleString('en-IN')}</td>
                        <td style="text-align: right;">
                            <button class="btn btn-ghost btn-sm" onclick="openOrderModal('${escapeHtml(o.order_id)}')">View</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function openOrderModal(orderId) {
    const order = ordersCacheList.find(o => o.order_id === orderId);
    if (!order) {
        showToast('Order not found', 'error');
        return;
    }

    document.getElementById('orderModalTitle').textContent = `Order ${order.order_id}`;

    const items = Array.isArray(order.items) ? order.items : [];
    const itemsHtml = items.length === 0
        ? '<p style="color: var(--text-muted);">No items recorded.</p>'
        : items.map(i => `
            <div class="item-line">
                <div>
                    <div>${escapeHtml(i.name || 'Product')}</div>
                    <div class="item-meta">${escapeHtml(i.size || '')} · ${escapeHtml(i.color || '')} · ×${Number(i.quantity || 1)}</div>
                </div>
                <div style="font-weight: 600; font-variant-numeric: tabular-nums;">NPR ${(Number(i.price || 0) * Number(i.quantity || 1)).toLocaleString('en-IN')}</div>
            </div>
        `).join('');

    document.getElementById('orderModalBody').innerHTML = `
        <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px;">
            ${statusBadge(order.status)}
            ${paymentBadge(order.payment_status, order.payment_method)}
        </div>

        <h4 style="font-family: var(--font-serif); margin-bottom: 10px;">Customer</h4>
        <dl class="kv-list" style="margin-bottom: 18px;">
            <dt>Name</dt><dd>${escapeHtml(order.name || '—')}</dd>
            <dt>Phone</dt><dd>${escapeHtml(order.phone || '—')}</dd>
            <dt>City</dt><dd>${escapeHtml(order.city || '—')}</dd>
            <dt>Address</dt><dd>${escapeHtml(order.address || '—')}</dd>
        </dl>

        <h4 style="font-family: var(--font-serif); margin-bottom: 10px;">Items</h4>
        <div style="margin-bottom: 18px;">${itemsHtml}</div>

        <div style="display: flex; justify-content: space-between; padding-top: 12px; border-top: 2px solid var(--border); font-weight: 600; font-size: 1.05rem;">
            <span>Total</span>
            <span style="font-variant-numeric: tabular-nums;">NPR ${Number(order.total || 0).toLocaleString('en-IN')}</span>
        </div>

        <div style="margin-top: 18px; padding: 12px 16px; background: var(--bg-subtle); border-radius: var(--radius-sm); font-size: 0.85rem; color: var(--text-muted);">
            <strong>Payment Reference:</strong> <code>${escapeHtml(order.txn || '—')}</code>
        </div>

        <div style="margin-top: 18px;">
            <h4 style="font-family: var(--font-serif); margin-bottom: 10px;">Update Status</h4>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${['pending', 'processing', 'shipped', 'delivered', 'cancelled'].map(s => `
                    <button class="btn btn-ghost btn-sm" onclick="updateOrderStatus('${escapeHtml(order.order_id)}', '${s}')" ${order.status === s ? 'disabled' : ''}>${capitalize(s)}</button>
                `).join('')}
            </div>
        </div>

        <div style="margin-top: 14px;">
            <h4 style="font-family: var(--font-serif); margin-bottom: 10px;">Update Payment</h4>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${['pending', 'paid', 'failed', 'refunded'].map(s => `
                    <button class="btn btn-ghost btn-sm" onclick="updatePaymentStatus('${escapeHtml(order.order_id)}', '${s}')" ${order.payment_status === s ? 'disabled' : ''}>${capitalize(s)}</button>
                `).join('')}
            </div>
        </div>
    `;

    document.getElementById('orderModalFoot').innerHTML = `
        <a href="https://wa.me/977${escapeHtml(order.phone || '')}?text=${encodeURIComponent('Hello ' + (order.name || '') + ', regarding your order ' + order.order_id)}" target="_blank" class="btn btn-ghost">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
            Contact Customer
        </a>
        <button class="btn btn-danger" onclick="cancelOrderConfirm('${escapeHtml(order.order_id)}')">Cancel Order</button>
        <button class="btn btn-primary" onclick="closeOrderModal()">Close</button>
    `;

    document.getElementById('orderModal').classList.add('open');
}

function closeOrderModal() {
    document.getElementById('orderModal').classList.remove('open');
}

async function updateOrderStatus(orderId, status) {
    try {
        await adminUpdateOrderStatus(orderId, status);
        showToast(`Order status updated to ${status}`, 'success');
        // Update local cache
        const o = ordersCacheList.find(x => x.order_id === orderId);
        if (o) o.status = status;
        openOrderModal(orderId);
        renderOrders();
    } catch (err) {
        showApiError(err);
    }
}

async function updatePaymentStatus(orderId, paymentStatus) {
    try {
        await adminUpdateOrderPayment(orderId, paymentStatus);
        showToast(`Payment status updated to ${paymentStatus}`, 'success');
        const o = ordersCacheList.find(x => x.order_id === orderId);
        if (o) o.payment_status = paymentStatus;
        openOrderModal(orderId);
        renderOrders();
    } catch (err) {
        showApiError(err);
    }
}

async function cancelOrderConfirm(orderId) {
    if (!confirm(`Cancel order ${orderId}? The record will be preserved but marked as cancelled.`)) return;
    try {
        await adminCancelOrder(orderId);
        showToast('Order cancelled', 'success');
        const o = ordersCacheList.find(x => x.order_id === orderId);
        if (o) o.status = 'cancelled';
        openOrderModal(orderId);
        renderOrders();
    } catch (err) {
        showApiError(err);
    }
}

// ==========================================================================
// PRODUCTS RENDER + ACTIONS
// ==========================================================================

function renderProducts() {
    const target = document.getElementById('productsList');
    if (productsCacheList.length === 0) {
        target.innerHTML = renderEmptyState('No products', 'Click "Add Product" to create your first product.');
        return;
    }
    let list = productsCacheList;
    if (productFilter === 'instock') list = list.filter(p => isInStock(p));
    else if (productFilter === 'out') list = list.filter(p => !isInStock(p));
    else if (productFilter === 'featured') list = list.filter(p => p.featured);

    if (productSearchText) {
        const q = productSearchText.toLowerCase();
        list = list.filter(p => (p.name || '').toLowerCase().includes(q));
    }
    if (list.length === 0) {
        target.innerHTML = renderEmptyState('No matching products', 'Try a different filter.');
        return;
    }
    target.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width: 60px;"></th>
                    <th>Product</th>
                    <th>Variants</th>
                    <th style="text-align: right;">Price</th>
                    <th>Status</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${list.map(p => `
                    <tr>
                        <td>
                            <img src="${(p.images && p.images[0]) || PLACEHOLDER_IMAGE}" alt="" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
                        </td>
                        <td>
                            <div style="font-weight: 600;">${escapeHtml(p.name)}</div>
                            <div style="font-size: 0.78rem; color: var(--text-muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.description || '')}</div>
                        </td>
                        <td style="font-size: 0.82rem; color: var(--text-muted);">
                            ${(p.sizes || []).length} size${(p.sizes || []).length === 1 ? '' : 's'} · ${(p.colors || []).length} color${(p.colors || []).length === 1 ? '' : 's'}
                        </td>
                        <td class="col-num" style="text-align: right; font-weight: 600;">
                            NPR ${Number(p.price || 0).toLocaleString('en-IN')}
                            ${p.original_price && p.original_price > p.price ? `<div style="font-size: 0.78rem; color: var(--text-muted); text-decoration: line-through; font-weight: 400;">NPR ${Number(p.original_price).toLocaleString('en-IN')}</div>` : ''}
                        </td>
                        <td>
                            ${isInStock(p) ? '<span class="badge badge-green">In Stock</span>' : '<span class="badge badge-red">Out of Stock</span>'}
                            ${p.featured ? '<div style="margin-top: 4px;"><span class="badge badge-gold">Featured</span></div>' : ''}
                        </td>
                        <td style="text-align: right; white-space: nowrap;">
                            <button class="btn btn-ghost btn-sm" onclick="openProductModal(${p.id})">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteProductConfirm(${p.id})">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function setupProductModal() {
    document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null));
    document.getElementById('productImageUpload').addEventListener('change', handleImageSelect);
}

function openProductModal(productId) {
    editingProductId = productId;
    uploadedImages = [];
    existingImages = [];

    const form = document.getElementById('productForm');
    form.reset();
    document.getElementById('uploadedImagesPreviews').innerHTML = '';
    document.getElementById('productInStockField').style.display = 'none';

    if (productId) {
        const p = productsCacheList.find(x => Number(x.id) === Number(productId));
        if (!p) { showToast('Product not found', 'error'); return; }
        document.getElementById('productModalTitle').textContent = `Edit: ${p.name}`;
        document.getElementById('productId').value = p.id;
        document.getElementById('productName').value = p.name || '';
        document.getElementById('productPrice').value = p.price || '';
        document.getElementById('productOriginalPrice').value = p.original_price || '';
        document.getElementById('productDescription').value = p.description || '';
        document.getElementById('productSizes').value = (p.sizes || []).join(', ');
        document.getElementById('productColors').value = (p.colors || []).join(', ');
        document.getElementById('productImageUrls').value = (p.images || []).join(', ');
        document.getElementById('productFeatured').checked = !!p.featured;
        document.getElementById('productInStock').checked = isInStock(p);
        document.getElementById('productInStockField').style.display = 'block';
        existingImages = [...(p.images || [])];
        renderProductImagePreviews();
    } else {
        document.getElementById('productModalTitle').textContent = 'Add Product';
        document.getElementById('productId').value = '';
    }
    document.getElementById('productModal').classList.add('open');
}

function closeProductModal() {
    document.getElementById('productModal').classList.remove('open');
    editingProductId = null;
    uploadedImages = [];
    existingImages = [];
    document.getElementById('uploadedImagesPreviews').innerHTML = '';
}

function handleImageSelect(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(f => {
        if (f.size > 5 * 1024 * 1024) {
            showToast(`${f.name} is too large (max 5MB)`, 'error');
            return;
        }
        if (!f.type.startsWith('image/')) {
            showToast(`${f.name} is not an image`, 'error');
            return;
        }
        uploadedImages.push(f);
    });
    e.target.value = '';
    renderProductImagePreviews();
}

function renderProductImagePreviews() {
    const container = document.getElementById('uploadedImagesPreviews');
    container.innerHTML = '';

    existingImages.forEach((url, i) => {
        const cell = document.createElement('div');
        cell.className = 'img-cell';
        cell.innerHTML = `
            <img src="${escapeHtml(url)}" alt="Existing image">
            <button type="button" class="remove" aria-label="Remove image" onclick="removeExistingImage(${i})">&times;</button>
        `;
        container.appendChild(cell);
    });

    uploadedImages.forEach((file, i) => {
        const url = URL.createObjectURL(file);
        const cell = document.createElement('div');
        cell.className = 'img-cell';
        cell.innerHTML = `
            <img src="${url}" alt="New image">
            <button type="button" class="remove" aria-label="Remove image" onclick="removeUploadedImage(${i})">&times;</button>
        `;
        container.appendChild(cell);
    });
}

function removeExistingImage(i) {
    existingImages.splice(i, 1);
    renderProductImagePreviews();
}

function removeUploadedImage(i) {
    uploadedImages.splice(i, 1);
    renderProductImagePreviews();
}

async function handleProductSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('productSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        // 1. Upload any new files
        const uploadedUrls = [];
        for (let i = 0; i < uploadedImages.length; i++) {
            const result = await uploadImage(uploadedImages[i]);
            if (result.error) {
                showToast(`Image upload failed: ${result.error}`, 'error');
                return;
            }
            uploadedUrls.push(result.url);
        }

        // 2. Compose images array
        const allImages = [...existingImages, ...uploadedUrls];

        // 3. Build payload
        const payload = {
            name: document.getElementById('productName').value.trim(),
            price: Number(document.getElementById('productPrice').value) || 0,
            description: document.getElementById('productDescription').value.trim(),
            sizes: document.getElementById('productSizes').value.split(',').map(s => s.trim()).filter(Boolean),
            colors: document.getElementById('productColors').value.split(',').map(c => c.trim()).filter(Boolean),
            images: allImages,
            featured: document.getElementById('productFeatured').checked,
        };
        const origPrice = document.getElementById('productOriginalPrice').value;
        if (origPrice) payload.original_price = Number(origPrice) || null;

        if (editingProductId) {
            // Status (in_stock) may not exist in old schema
            payload.in_stock = document.getElementById('productInStock').checked;
            await adminUpdateProduct(editingProductId, payload);
            showToast('Product updated', 'success');
        } else {
            await adminCreateProduct(payload);
            showToast('Product created', 'success');
        }

        closeProductModal();
        await loadProducts();
    } catch (err) {
        showApiError(err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Product';
    }
}

async function deleteProductConfirm(id) {
    const p = productsCacheList.find(x => Number(x.id) === Number(id));
    if (!p) return;
    if (!confirm(`Delete "${p.name}"? If this product has past orders, it will be marked out-of-stock instead to preserve history.`)) return;
    try {
        const res = await adminDeleteProduct(id);
        if (res.soft_deleted) {
            showToast('Product marked out of stock (has order history)', 'success');
        } else {
            showToast('Product deleted', 'success');
        }
        await loadProducts();
    } catch (err) {
        showApiError(err);
    }
}

// ==========================================================================
// INVENTORY VIEW (size × color matrix)
// ==========================================================================

function renderInventory() {
    const target = document.getElementById('inventoryList');
    if (productsCacheList.length === 0) {
        target.innerHTML = renderEmptyState('No products', 'Add products to see their variant matrix.');
        return;
    }
    target.innerHTML = productsCacheList.map(p => {
        const sizes = p.sizes || [];
        const colors = p.colors || [];
        const inStock = isInStock(p);
        const variantCount = sizes.length * colors.length;
        return `
            <div class="card">
                <div class="card-head">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${(p.images && p.images[0]) || PLACEHOLDER_IMAGE}" alt="" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
                        <div>
                            <h3 style="margin: 0;">${escapeHtml(p.name)}</h3>
                            <div class="subtle">${variantCount} variant${variantCount === 1 ? '' : 's'} · NPR ${Number(p.price || 0).toLocaleString('en-IN')}</div>
                        </div>
                    </div>
                    <div>
                        ${inStock ? '<span class="badge badge-green">In Stock</span>' : '<span class="badge badge-red">Out of Stock</span>'}
                        <button class="btn btn-ghost btn-sm" style="margin-left: 8px;" onclick="openProductModal(${p.id})">Edit</button>
                    </div>
                </div>
                ${sizes.length === 0 || colors.length === 0 ? `
                    <p style="color: var(--text-muted); padding: 8px 0;">No variants defined.</p>
                ` : `
                    <div style="overflow-x: auto;">
                        <table class="data-table" style="min-width: 480px;">
                            <thead>
                                <tr>
                                    <th></th>
                                    ${sizes.map(s => `<th style="text-align: center;">${escapeHtml(s)}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${colors.map(c => `
                                    <tr>
                                        <td style="font-weight: 600; color: var(--text-dark);">${escapeHtml(c)}</td>
                                        ${sizes.map(s => {
                                            const status = inStock ? 'available' : 'oos';
                                            return `<td style="text-align: center;"><span class="badge ${inStock ? 'badge-green' : 'badge-red'}">${inStock ? 'Available' : 'OOS'}</span></td>`;
                                        }).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

// ==========================================================================
// CUSTOMERS VIEW (derived from orders)
// ==========================================================================

function deriveCustomers(orders) {
    const map = new Map();
    orders.forEach(o => {
        const key = (o.phone || o.name || '').trim();
        if (!key) return;
        if (!map.has(key)) {
            map.set(key, {
                name: o.name || 'Unknown',
                phone: o.phone || '',
                city: o.city || '',
                address: o.address || '',
                orderCount: 0,
                totalSpent: 0,
                lastOrderAt: o.created_at,
            });
        }
        const c = map.get(key);
        c.orderCount += 1;
        c.totalSpent += Number(o.total) || 0;
        if (new Date(o.created_at) > new Date(c.lastOrderAt || 0)) {
            c.lastOrderAt = o.created_at;
        }
    });
    return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}

function renderCustomers() {
    const target = document.getElementById('customersList');
    let list = customersCacheList;
    if (customerSearchText) {
        const q = customerSearchText.toLowerCase();
        list = list.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.phone || '').toLowerCase().includes(q) ||
            (c.city || '').toLowerCase().includes(q)
        );
    }
    if (list.length === 0) {
        target.innerHTML = renderEmptyState(
            customersCacheList.length === 0 ? 'No customers yet' : 'No matching customers',
            customersCacheList.length === 0
                ? 'Customer profiles are created from order history.'
                : 'Try a different search term.'
        );
        return;
    }
    target.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Customer</th>
                    <th>Contact</th>
                    <th>Location</th>
                    <th style="text-align: right;">Orders</th>
                    <th style="text-align: right;">Total Spent</th>
                    <th>Last Order</th>
                </tr>
            </thead>
            <tbody>
                ${list.map(c => `
                    <tr>
                        <td>
                            <div style="font-weight: 600;">${escapeHtml(c.name)}</div>
                        </td>
                        <td>${escapeHtml(c.phone || '—')}</td>
                        <td>${escapeHtml(c.city || '—')}</td>
                        <td class="col-num" style="text-align: right;">${c.orderCount}</td>
                        <td class="col-num" style="text-align: right; font-weight: 600;">NPR ${c.totalSpent.toLocaleString('en-IN')}</td>
                        <td style="font-size: 0.85rem; color: var(--text-muted);">${formatDate(c.lastOrderAt)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ==========================================================================
// HELPERS
// ==========================================================================

function isInStock(p) {
    if (p.in_stock === true) return true;
    if (p.in_stock === false) return false;
    if (p.instock === true) return true;
    if (p.instock === false) return false;
    return true; // default optimistic
}

function statusBadge(status) {
    const s = status || 'pending';
    const map = {
        pending: 'badge-amber',
        processing: 'badge-blue',
        shipped: 'badge-gold',
        delivered: 'badge-green',
        cancelled: 'badge-red',
    };
    return `<span class="badge ${map[s] || 'badge-grey'}">${capitalize(s)}</span>`;
}

function paymentBadge(paymentStatus, paymentMethod) {
    const ps = paymentStatus || 'pending';
    const pm = paymentMethod || 'cod';
    const map = {
        pending: 'badge-amber',
        paid: 'badge-green',
        failed: 'badge-red',
        refunded: 'badge-grey',
    };
    return `<span class="badge ${map[ps] || 'badge-grey'}">${pm.toUpperCase()} · ${capitalize(ps)}</span>`;
}

function statusColor(status) {
    const map = {
        pending: '#F59E0B',
        processing: '#4A6FA5',
        shipped: '#C9A050',
        delivered: '#10B981',
        cancelled: '#DC2626',
    };
    return map[status] || '#A89B8E';
}

function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return iso;
    }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderEmptyState(title, detail) {
    return `
        <div class="state-block">
            <div class="state-icon">📭</div>
            <div class="state-title">${escapeHtml(title)}</div>
            <div class="state-detail">${escapeHtml(detail)}</div>
        </div>
    `;
}

function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function showToast(message, kind) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast-' + kind : '');
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
        t.style.transition = 'opacity 0.3s';
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

function showApiError(err) {
    console.error('API error:', err);
    let msg = err && err.message ? err.message : 'Unknown error';
    if (err && err.status === 401) {
        msg = 'Your session has expired. Please log in again.';
        setAdminToken('');
        sessionStorage.removeItem('shree_admin_auth');
        setTimeout(() => window.location.reload(), 1500);
    } else if (err && err.status === 400 && /column/i.test(msg)) {
        msg = 'Database schema is missing required columns. Run sql/001_admin_columns.sql in Supabase SQL Editor.';
    } else if (err && err.status === 404) {
        msg = 'API endpoint not found. Make sure serverless functions are deployed.';
    }
    showToast(msg, 'error');
}
