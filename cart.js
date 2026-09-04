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
            maxStock: product.stock || 99
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
    const countBadges = document.querySelectorAll('.cart-count, #cartCount, [data-cart-count]');
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

    if (cartItemsContainer) {
        if (cart.length === 0) {
            if (cartEmptyState) cartEmptyState.style.display = 'flex';
            if (cartHasItems) cartHasItems.style.display = 'none';
            cartItemsContainer.innerHTML = '';
        } else {
            if (cartEmptyState) cartEmptyState.style.display = 'none';
            if (cartHasItems) cartHasItems.style.display = 'block';

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

// Validate stock before checkout
async function validateCartStock() {
    const stockErrors = [];

    for (const item of cart) {
        try {
            const product = await getProductById(item.id);
            if (product) {
                const availableStock = product.stock || 99;
                if (item.quantity > availableStock) {
                    stockErrors.push({
                        name: item.name,
                        requested: item.quantity,
                        available: availableStock
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

// Submit order with specific payment method
async function submitOrder(orderData, paymentMethod = 'cod') {
    const orderId = generateOrderId();
    const totalAmount = getCartTotal();

    const orderRecord = {
        orderId,
        date: new Date().toISOString(),
        name: orderData.name,
        phone: orderData.phone,
        city: orderData.city,
        address: orderData.address,
        txn: orderData.txn || (paymentMethod === 'cod' ? 'Cash on Delivery' : 'Pending eSewa'),
        items: cart.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            size: item.size,
            color: item.color,
            quantity: item.quantity
        })),
        total: totalAmount,
        paymentMethod,
        status: paymentMethod === 'cod' ? 'confirmed' : 'pending_payment'
    };

    // Save pending order for eSewa flow
    if (paymentMethod === 'esewa') {
        savePendingOrder(orderRecord);
    }

    // Try to save to database
    if (typeof createOrder === 'function') {
        try {
            const success = await createOrder(orderRecord);
            if (!success) {
                showToast('Could not save order. Please try again.', 'error');
                return null;
            }
        } catch (e) {
            console.error('Order save error:', e);
            showToast('Connection error. Please try again.', 'error');
            return null;
        }
    }

    return orderRecord;
}

// Complete eSewa payment (customer clicked "I have paid")
async function confirmEsewaPayment() {
    const pending = getPendingOrder();
    if (!pending) {
        showToast('No pending order found', 'error');
        return false;
    }

    // Update order status
    pending.status = 'paid';
    pending.paidAt = new Date().toISOString();

    if (typeof updateOrderStatus === 'function') {
        await updateOrderStatus(pending.orderId, 'paid', 'esewa');
    }

    // Clear pending order and cart
    clearPendingOrder();
    clearCart();

    return pending;
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
*Payment Method:* ${orderData.paymentMethod === 'esewa' ? 'eSewa (Paid)' : 'Cash on Delivery'}

_Please confirm my order and share shipping updates!_ 🙏`;
}

// Send order via WhatsApp
function sendOrderViaWhatsApp(orderData) {
    const message = generateWhatsAppOrder(orderData);
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
    confirmEsewaPayment,
    generateOrderId,
    showToast
};
