// ==========================================================================
// SHREE COLLECTION - SHOPPING CART & CHECKOUT SYSTEM
// ==========================================================================

const CART_STORAGE_KEY = 'shree_collection_cart';
const PENDING_ORDER_KEY = 'shree_collection_pending_order';

// Fallbacks if config.js is not loaded
const SHOP_PHONE = (typeof STORE_CONFIG !== 'undefined') ? STORE_CONFIG.primaryPhone : '9841735450';
const WHATSAPP_NUMBER = (typeof STORE_CONFIG !== 'undefined') ? STORE_CONFIG.whatsappNumber : '9779841735450';
const ORDER_PREFIX = (typeof STORE_CONFIG !== 'undefined') ? STORE_CONFIG.order.prefix : 'SHREE-';

let cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];

// ==========================================================================
// CART CORE FUNCTIONS
// ==========================================================================

// Save cart to LocalStorage
function saveCart() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    updateCartUI();
    updateCartBadges();
}

// Add item to cart with optional quantity
async function addToCart(productId, size = null, color = null, quantity = 1) {
    const product = await getProductById(productId);
    if (!product) {
        showToast('Product not found', 'error');
        return;
    }

    const selectedSize = size || (product.sizes && product.sizes[0]) || 'Free Size';
    const selectedColor = color || (product.colors && product.colors[0]) || 'Standard';

    const existingIndex = cart.findIndex(
        item => item.id === product.id && item.size === selectedSize && item.color === selectedColor
    );

    if (existingIndex > -1) {
        cart[existingIndex].quantity += quantity;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            originalPrice: product.originalPrice || null,
            image: product.images && product.images[0] ? product.images[0] : 'assets/placeholder.jpg',
            size: selectedSize,
            color: selectedColor,
            quantity: quantity,
            // The products table exposes `in_stock` (boolean), not a stock
            // count. We cap per-line at a sane default; the server is the
            // final authority on per-line availability.
            maxStock: 10
        });
    }

    saveCart();
    showToast(`"${product.name}" added to cart!`);

    // Open cart drawer automatically
    openCartDrawer();
}

// Update quantity with bounds checking
function updateQuantity(index, delta) {
    if (!cart[index]) return;

    const newQty = cart[index].quantity + delta;
    const maxStock = cart[index].maxStock || 99;

    if (newQty <= 0) {
        removeFromCart(index);
    } else if (newQty > maxStock) {
        showToast(`Only ${maxStock} available in stock`, 'warning');
        cart[index].quantity = maxStock;
        saveCart();
    } else {
        cart[index].quantity = newQty;
        saveCart();
    }
}

// Set specific quantity
function setQuantity(index, qty) {
    if (!cart[index]) return;

    if (qty <= 0) {
        removeFromCart(index);
        return;
    }

    const maxStock = cart[index].maxStock || 99;
    const newQty = Math.min(qty, maxStock);

    cart[index].quantity = newQty;
    if (qty > maxStock) {
        showToast(`Only ${maxStock} available in stock`, 'warning');
    }
    saveCart();
}

// Remove from cart
function removeFromCart(index) {
    const item = cart[index];
    cart.splice(index, 1);
    saveCart();
    if (item) {
        showToast(`"${item.name}" removed`);
    }
}

// Clear entire cart
function clearCart() {
    cart = [];
    saveCart();
    showToast('Cart cleared');
}

// Calculate totals
function getCartTotal() {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

function getCartCount() {
    return cart.reduce((count, item) => count + item.quantity, 0);
}

function getCartSubtotal() {
    return cart.reduce((total, item) => {
        const origPrice = item.originalPrice || item.price;
        return total + (origPrice * item.quantity);
    }, 0);
}

// ==========================================================================
// UI UPDATE FUNCTIONS
// ==========================================================================

// Update cart count badges
function updateCartBadges() {
    const countBadges = document.querySelectorAll('.cart-count, #cartCount, #cartHeaderCount, [data-cart-count]');
    const totalCount = getCartCount();

    countBadges.forEach(badge => {
        badge.textContent = totalCount;
        badge.style.display = totalCount > 0 ? 'flex' : 'none';
        badge.classList.toggle('has-items', totalCount > 0);
    });
}

// Update cart drawer UI
function updateCartUI() {
    updateCartBadges();

    const cartTotalEl = document.getElementById('cartTotal');
    if (cartTotalEl) {
        cartTotalEl.textContent = 'NPR ' + getCartTotal().toLocaleString('en-IN');
    }

    const cartSubtotalEl = document.getElementById('cartSubtotal');
    if (cartSubtotalEl) {
        const subtotal = getCartSubtotal();
        const total = getCartTotal();
        cartSubtotalEl.innerHTML = subtotal > total
            ? `<span class="original-price">NPR ${subtotal.toLocaleString('en-IN')}</span>`
            : '';
    }

    const cartItemsContainer = document.getElementById('cartItems');
    const cartEmptyState = document.getElementById('cartEmptyState');
    const cartHasItems = document.getElementById('cartHasItems');
    const cartHasItemsFooter = document.getElementById('cartHasItemsFooter');

    if (cartItemsContainer) {
        if (cart.length === 0) {
            if (cartEmptyState) cartEmptyState.style.display = 'flex';
            if (cartHasItems) cartHasItems.style.display = 'none';
            if (cartHasItemsFooter) cartHasItemsFooter.style.display = 'none';
            cartItemsContainer.innerHTML = '';
        } else {
            if (cartEmptyState) cartEmptyState.style.display = 'none';
            if (cartHasItems) cartHasItems.style.display = 'block';
            if (cartHasItemsFooter) cartHasItemsFooter.style.display = 'block';

            cartItemsContainer.innerHTML = cart.map((item, index) => {
                const itemTotal = item.price * item.quantity;
                const hasDiscount = item.originalPrice && item.originalPrice > item.price;

                return `
                    <div class="cart-item" data-index="${index}">
                        <a href="product.html?id=${item.id}" class="cart-item-image">
                            <img src="${item.image}" alt="${item.name}" loading="lazy">
                        </a>
                        <div class="cart-item-details">
                            <a href="product.html?id=${item.id}" class="cart-item-name">${item.name}</a>
                            <div class="cart-item-meta">
                                <span class="cart-item-variant">Size: <strong>${item.size}</strong></span>
                                <span class="cart-item-variant">Color: <strong>${item.color}</strong></span>
                            </div>
                            <div class="cart-item-price-row">
                                <span class="cart-item-price">NPR ${itemTotal.toLocaleString('en-IN')}</span>
                                ${hasDiscount ? `<span class="cart-item-original">NPR ${(item.originalPrice * item.quantity).toLocaleString('en-IN')}</span>` : ''}
                            </div>
                            <div class="cart-item-actions">
                                <div class="quantity-control">
                                    <button type="button" class="qty-btn qty-decrease" onclick="updateQuantity(${index}, -1)" aria-label="Decrease quantity">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    </button>
                                    <input type="number" class="qty-input" value="${item.quantity}" min="1" max="${item.maxStock || 99}"
                                        onchange="setQuantity(${index}, parseInt(this.value) || 1)" aria-label="Quantity">
                                    <button type="button" class="qty-btn qty-increase" onclick="updateQuantity(${index}, 1)" aria-label="Increase quantity">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    </button>
                                </div>
                                <button type="button" class="cart-item-remove" onclick="removeFromCart(${index})" aria-label="Remove item">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                    Remove
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // Update checkout button state
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) {
        checkoutBtn.disabled = cart.length === 0;
    }
}

// ==========================================================================
// CART DRAWER
// ==========================================================================

function openCartDrawer() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');

    if (drawer) {
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    if (overlay) {
        overlay.classList.add('open');
    }
}

function closeCartDrawer() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');

    if (drawer) {
        drawer.classList.remove('open');
        document.body.style.overflow = '';
    }
    if (overlay) {
        overlay.classList.remove('open');
    }
}

// ==========================================================================
// CHECKOUT FLOW
// ==========================================================================

// Generate unique order ID
function generateOrderId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${ORDER_PREFIX}${timestamp}${random}`;
}

// Check for duplicate pending order
function hasPendingOrder() {
    return localStorage.getItem(PENDING_ORDER_KEY) !== null;
}

function getPendingOrder() {
    try {
        return JSON.parse(localStorage.getItem(PENDING_ORDER_KEY));
    } catch {
        return null;
    }
}

function savePendingOrder(orderData) {
    localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(orderData));
}

function clearPendingOrder() {
    localStorage.removeItem(PENDING_ORDER_KEY);
}

// Validate stock before checkout. The products table exposes a boolean
// `in_stock` column (and historically a `stock` int via inventory), not
// the `product.stock` key the old code read. We check `in_stock` and
// cap at a sane per-line maximum; the authoritative recompute lives in
// the server-side /api/orders endpoint.
async function validateCartStock() {
    const stockErrors = [];
    const MAX_PER_LINE = 10; // mirrors server INVENTORY_PER_ITEM_CAP default

    for (const item of cart) {
        try {
            const product = await getProductById(item.id);
            if (product) {
                if (product.in_stock === false) {
                    stockErrors.push({
                        name: item.name,
                        requested: item.quantity,
                        available: 0,
                        outOfStock: true
                    });
                    continue;
                }
                if (item.quantity > MAX_PER_LINE) {
                    stockErrors.push({
                        name: item.name,
                        requested: item.quantity,
                        available: MAX_PER_LINE,
                        overCap: true
                    });
                }
            }
        } catch (e) {
            console.warn('Could not validate stock for item:', item.name);
        }
    }

    return stockErrors;
}

// Proceed to checkout
async function proceedToCheckout() {
    if (cart.length === 0) {
        showToast('Your cart is empty', 'warning');
        return;
    }

    // Check for pending order
    if (hasPendingOrder()) {
        const pending = getPendingOrder();
        showToast('You have a pending order. Please complete or cancel it first.', 'warning');
        // Redirect to checkout with pending order
        window.location.href = 'checkout.html?pending=true';
        return;
    }

    // Validate stock
    const stockErrors = await validateCartStock();
    if (stockErrors.length > 0) {
        const hasOutOfStock = stockErrors.some(e => e.outOfStock);
        if (hasOutOfStock) {
            const names = stockErrors.filter(e => e.outOfStock).map(e => e.name).join(', ');
            showToast(`Out of stock: ${names}. Please remove these items.`, 'error');
            return;
        }
        const errorMsg = stockErrors.map(e =>
            `${e.name}: only ${e.available} available`
        ).join(', ');
        showToast(`Stock issue: ${errorMsg}`, 'error');

        // Update cart with corrected quantities
        stockErrors.forEach(error => {
            const item = cart.find(i => i.name === error.name);
            if (item) {
                item.quantity = error.available;
                item.maxStock = error.available;
            }
        });
        saveCart();
        return;
    }

    // Redirect to checkout page
    window.location.href = 'checkout.html';
}

// ==========================================================================
// ORDER SUBMISSION
// ==========================================================================

// Re-entrancy guard. The submit button click handler in checkout.html
// also sets a local guard, but this module-level flag protects against
// accidental double-invocation from any code path (button click, Enter
// key, auto-submit, retry). Cleared on success, error, and after a
// short cooldown so a user can retry after a network blip.
let submitInFlight = false;

async function submitOrder(orderData, paymentMethod = 'cod') {
    if (submitInFlight) {
        console.warn('submitOrder ignored: another submission is already in flight.');
        return null;
    }
    submitInFlight = true;

    try {
        const totalAmount = getCartTotal();

        // The new /api/orders endpoint re-reads every product and
        // recomputes the total from server-side prices. We pass the
        // client total as advisory only — the server total wins.
        const createPayload = {
            name: orderData.name,
            phone: orderData.phone,
            city: orderData.city,
            address: orderData.address,
            items: cart.map(item => ({
                id: item.id,
                size: item.size,
                color: item.color,
                quantity: item.quantity,
            })),
            total: totalAmount,
            paymentMethod,
            txn: orderData.txn || null,
        };

        if (typeof createOrder !== 'function') {
            showToast('Order system is not ready. Please refresh the page.', 'error');
            return null;
        }

        const result = await createOrder(createPayload);
        if (!result || !result.ok) {
            // createOrder already toasted a useful message; nothing more
            // to do here. The server's error message was specific to the
            // failure (out of stock, invalid size, etc.).
            return null;
        }

        // Use the server-issued order_id; never trust the client to
        // generate the order number anymore. The server is authoritative
        // on price/total, so the cart's local prices can stay stale.
        const orderRecord = {
            orderId: result.orderId,
            date: new Date().toISOString(),
            name: orderData.name,
            phone: orderData.phone,
            city: orderData.city,
            address: orderData.address,
            txn: orderData.txn || (paymentMethod === 'cod' ? 'Cash on Delivery' : null),
            items: cart.map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                size: item.size,
                color: item.color,
                quantity: item.quantity,
            })),
            total: result.total, // server's recomputed value
            paymentMethod,
            // The DB schema's CHECK constraint allows only pending /
            // processing / shipped / delivered / cancelled. The server
            // inserts 'pending' and only the admin can move it forward.
            status: 'pending',
            paymentStatus: result.paymentStatus || 'pending',
        };

        // For eSewa: persist a local pending-order record so the success
        // page (and a refresh on the same browser) can find the order by
        // id + phone without re-prompting. The actual eSewa transaction
        // reference submission happens in confirmEsewaSubmission() AFTER
        // the order is on file.
        if (paymentMethod === 'esewa') {
            savePendingOrder(orderRecord);
        }

        // Clear the cart as soon as the order is on file. We don't wait
        // for the eSewa txn ref to be submitted — that's a follow-up,
        // not a prerequisite for the order existing.
        cart = [];
        saveCart();

        return orderRecord;
    } catch (e) {
        console.error('Order save error:', e);
        showToast('Connection error. Please try again.', 'error');
        return null;
    } finally {
        // Allow retry shortly after; prevents a click-spam from creating
        // duplicate orders if a previous call was aborted mid-flight.
        setTimeout(() => { submitInFlight = false; }, 250);
    }
}

// Submit the eSewa transaction reference to the server. This is called
// from the checkout page's "I have paid" button after the customer has
// typed the reference into the txn field. The server stores the
// reference but does NOT mark the order as paid — only the admin
// "Verify Payment" action does that. The customer flow is honest UX:
// "submitted, awaiting verification", not "paid".
async function confirmEsewaSubmission({ orderId, phone, txn }) {
    if (!orderId || !phone || !txn) {
        showToast('Order ID, phone, and transaction reference are all required.', 'error');
        return { ok: false, error: 'missing_fields' };
    }

    if (typeof submitEsewaTransaction !== 'function') {
        showToast('Order system is not ready. Please refresh the page.', 'error');
        return { ok: false, error: 'not_ready' };
    }

    const result = await submitEsewaTransaction({ orderId, phone, txn });
    if (result && result.ok) {
        // Update the local pending-order record so a refresh sees the
        // txn we just submitted. The order itself remains 'pending'
        // payment status — the admin still has to verify.
        const pending = getPendingOrder();
        if (pending && pending.orderId === orderId) {
            pending.txn = txn;
            pending.txnSubmittedAt = new Date().toISOString();
            savePendingOrder(pending);
        }
    }
    return result;
}

// ==========================================================================
// WHATSAPP ORDER
// ==========================================================================

// Generate WhatsApp order message
function generateWhatsAppOrder(orderData) {
    const totalAmount = getCartTotal();
    const orderId = generateOrderId();

    let itemsListText = cart.map(item =>
        `• ${item.name} (${item.size}, ${item.color}) ×${item.quantity} = NPR ${(item.price * item.quantity).toLocaleString('en-IN')}`
    ).join('\n');

    return `🌸 *NEW ORDER - SHREE COLLECTION* 🌸
*Order ID:* ${orderId}

*Customer Details:*
• Name: ${orderData.name}
• Phone: ${orderData.phone}
• City/District: ${orderData.city}
• Delivery Address: ${orderData.address}

*Order Items:*
${itemsListText}

*Total Amount:* NPR ${totalAmount.toLocaleString('en-IN')}
*Payment Method:* ${orderData.paymentMethod === 'esewa' ? 'eSewa (manual verification by Shree Collection)' : 'Cash on Delivery'}

_Please confirm my order and share shipping updates!_ 🙏`;
}

// Send order via WhatsApp
function sendOrderViaWhatsApp(orderData) {
    const message = generateWhatsAppOrder(orderData);
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encoded}`, '_blank');
}

// Send entire cart via WhatsApp
function sendCartViaWhatsApp() {
    if (cart.length === 0) {
        showToast('Your cart is empty', 'warning');
        return;
    }

    const total = getCartTotal();
    let itemsList = cart.map(item =>
        `• ${item.name} (${item.size}, ${item.color}) ×${item.quantity} = NPR ${(item.price * item.quantity).toLocaleString('en-IN')}`
    ).join('\n');

    const message = `🌸 *NEW ORDER - SHREE COLLECTION* 🌸

*Order Details:*
${itemsList}

*Total Amount:* NPR ${total.toLocaleString('en-IN')}
*Payment:* Cash on Delivery

_Please confirm my order and share shipping details!_ 🙏`;

    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encoded}`, '_blank');
}

// Quick WhatsApp order for single product
async function orderViaWhatsApp(productId) {
    const product = await getProductById(productId);
    if (!product) {
        showToast('Product not found', 'error');
        return;
    }

    const message = encodeURIComponent(
        `Namaste Shree Collection! 🙏

I am interested in ordering:
*Product:* ${product.name}
*Price:* NPR ${product.price.toLocaleString('en-IN')}
*Link:* ${window.location.origin}/product.html?id=${product.id}

Please let me know the availability and payment details.`
    );
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================

function showToast(message, type = 'success') {
    let toast = document.getElementById('cartToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cartToast';
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }

    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    };

    toast.className = `cart-toast cart-toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.success}</span><span class="toast-message">${message}</span>`;
    toast.classList.add('show');

    clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==========================================================================
// EVENT LISTENERS
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    updateCartUI();

    // Cart button
    const cartBtn = document.getElementById('cartBtn');
    if (cartBtn) {
        cartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openCartDrawer();
        });
    }

    // Close drawer
    const closeBtn = document.getElementById('closeCartDrawer');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeCartDrawer);
    }

    // Overlay click
    const overlay = document.getElementById('cartOverlay');
    if (overlay) {
        overlay.addEventListener('click', closeCartDrawer);
    }

    // Checkout button
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', proceedToCheckout);
    }

    // Escape key to close drawer
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCartDrawer();
        }
    });
});

// ==========================================================================
// HELPER: Copy text to clipboard
// ==========================================================================

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Copied to clipboard!');
    });
}

// Export for use in other scripts
window.cartFunctions = {
    addToCart,
    updateQuantity,
    setQuantity,
    removeFromCart,
    clearCart,
    getCartTotal,
    getCartCount,
    submitOrder,
    confirmEsewaSubmission,
    generateOrderId,
    showToast
};
