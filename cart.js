// ==========================================================================
// SHREE COLLECTION - SHOPPING CART & QR CHECKOUT SYSTEM
// ==========================================================================

const CART_STORAGE_KEY = 'shree_collection_cart';
// Fallbacks if config.js is not loaded
const SHOP_PHONE = (typeof STORE_CONFIG !== 'undefined') ? STORE_CONFIG.primaryPhone : '9766269025';
const WHATSAPP_NUMBER = (typeof STORE_CONFIG !== 'undefined') ? STORE_CONFIG.whatsappNumber : '9779766269025';

let cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];

// Save cart to LocalStorage
function saveCart() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    updateCartUI();
}

// Add item to cart
async function addToCart(productId, size = null, color = null) {
    const product = await getProductById(productId);
    if (!product) {
        showToast('❌ Product not found');
        return;
    }

    const selectedSize = size || (product.sizes && product.sizes[0]) || 'Free Size';
    const selectedColor = color || (product.colors && product.colors[0]) || 'Standard';

    const existingIndex = cart.findIndex(
        item => item.id === product.id && item.size === selectedSize && item.color === selectedColor
    );

    if (existingIndex > -1) {
        cart[existingIndex].quantity += 1;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.images[0],
            size: selectedSize,
            color: selectedColor,
            quantity: 1
        });
    }

    saveCart();
    showToast(`Added "${product.name}" to your cart!`);
}

// Update quantity
function updateQuantity(index, delta) {
    if (!cart[index]) return;
    cart[index].quantity += delta;
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    }
    saveCart();
}

// Remove from cart
function removeFromCart(index) {
    cart.splice(index, 1);
    saveCart();
    showToast("Item removed from cart");
}

// Calculate totals
function getCartTotal() {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

function getCartCount() {
    return cart.reduce((count, item) => count + item.quantity, 0);
}

// Update Cart Count & Drawer UI
function updateCartUI() {
    const countBadges = document.querySelectorAll('.cart-count, #cartCount');
    const totalCount = getCartCount();
    countBadges.forEach(b => {
        b.textContent = totalCount;
        b.style.display = totalCount > 0 ? 'flex' : 'none';
    });

    const cartTotalEl = document.getElementById('cartTotal');
    if (cartTotalEl) {
        cartTotalEl.textContent = getCartTotal().toLocaleString('en-IN');
    }

    const cartItemsContainer = document.getElementById('cartItems');
    if (cartItemsContainer) {
        if (cart.length === 0) {
            cartItemsContainer.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                    <p style="font-size: 1.05rem; font-weight: 500;">Your cart is currently empty</p>
                    <p style="font-size: 0.85rem; margin-top: 4px;">Explore our catalog for the latest ethnic wear</p>
                </div>
            `;
        } else {
            cartItemsContainer.innerHTML = cart.map((item, index) => `
                <div class="cart-item">
                    <img src="${item.image}" alt="${item.name}">
                    <div class="cart-item-info">
                        <div class="cart-item-title">${item.name}</div>
                        <div class="cart-item-meta">Size: <strong>${item.size}</strong> | Color: <strong>${item.color}</strong></div>
                        <div class="cart-item-price">NPR ${(item.price * item.quantity).toLocaleString('en-IN')}</div>
                        <div class="cart-qty-control">
                            <button class="cart-qty-btn" onclick="updateQuantity(${index}, -1)">-</button>
                            <span style="font-size: 0.9rem; font-weight: 600; min-width: 20px; text-align: center;">${item.quantity}</span>
                            <button class="cart-qty-btn" onclick="updateQuantity(${index}, 1)">+</button>
                            <button onclick="removeFromCart(${index})" style="background: none; border: none; color: #DC2626; font-size: 0.8rem; margin-left: 12px; cursor: pointer; text-decoration: underline;">Remove</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }
}

// Toast notification helper
function showToast(message) {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>✨</span> <span>${message}</span>`;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3200);
}

// Direct WhatsApp order for single product
async function orderViaWhatsApp(productId) {
    const product = await getProductById(productId);
    if (!product) {
        showToast('❌ Product not found');
        return;
    }

    const message = encodeURIComponent(
        `Namaste Shree Collection! 🙏\n\nI am interested in ordering:\n*Product:* ${product.name}\n*Price:* NPR ${product.price.toLocaleString('en-IN')}\n*Link:* ${window.location.origin}/product.html?id=${product.id}\n\nPlease let me know the availability and payment details.`
    );
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}

// QR Checkout & WhatsApp Complete Flow
function openCheckoutModal() {
    if (cart.length === 0) {
        showToast("Your cart is empty! Please add products first.");
        return;
    }

    let checkoutModal = document.getElementById('checkoutModal');
    if (!checkoutModal) {
        checkoutModal = document.createElement('div');
        checkoutModal.id = 'checkoutModal';
        checkoutModal.className = 'modal';
        document.body.appendChild(checkoutModal);
    }

    const totalAmount = getCartTotal();

    // Use local QR code from assets folder
    const qrCodePath = 'assets/qr-code.png';

    checkoutModal.innerHTML = `
        <div class="modal-content checkout-modal-content">
            <div class="modal-header">
                <h2>Direct Checkout & Payment</h2>
                <button class="close-btn" onclick="closeCheckoutModal()">&times;</button>
            </div>

            <div class="checkout-steps">
                <div class="step-indicator active">1. Delivery Info</div>
                <div class="step-indicator active">2. QR Pay / Verification</div>
            </div>

            <div class="checkout-body">
                <form id="checkoutForm" onsubmit="handleCheckoutSubmit(event)">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div class="form-group">
                            <label>Full Name *</label>
                            <input type="text" id="custName" class="form-control" placeholder="e.g. Anjali Sharma" required>
                        </div>
                        <div class="form-group">
                            <label>Phone / WhatsApp *</label>
                            <input type="tel" id="custPhone" class="form-control" placeholder="e.g. 9766269025" required>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div class="form-group">
                            <label>City / District in Nepal *</label>
                            <input type="text" id="custCity" class="form-control" placeholder="e.g. Butwal, Rupandehi" required>
                        </div>
                        <div class="form-group">
                            <label>Full Delivery Address *</label>
                            <input type="text" id="custAddress" class="form-control" placeholder="Street, Ward No, Landmark" required>
                        </div>
                    </div>

                    <div class="qr-box-container">
                        <h3 style="color: var(--primary); font-size: 1.15rem; margin-bottom: 4px;">Scan & Pay via eSewa or Mobile Banking</h3>
                        <p style="font-size: 0.85rem; color: var(--text-muted);">Total Payable: <strong style="color: var(--primary); font-size: 1.1rem;">NPR ${totalAmount.toLocaleString('en-IN')}</strong></p>

                        <img src="${qrCodePath}" alt="Payment QR Code" class="qr-image">

                        <div>
                            <div class="copy-phone-box" onclick="copyShopPhone()">
                                <span>📱 Registered Phone: <strong>${SHOP_PHONE}</strong></span>
                                <span style="font-size: 0.75rem; background: var(--bg-cream); padding: 2px 6px; border-radius: 4px;">Copy</span>
                            </div>
                        </div>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px;">Scan with eSewa or any Mobile Banking App</p>
                    </div>

                    <div class="form-group">
                        <label>Transaction ID / Remarks (Optional)</label>
                        <input type="text" id="custTxn" class="form-control" placeholder="e.g. eSewa Ref ID: 12345678">
                    </div>

                    <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 10px;">
                        <button type="submit" class="checkout-btn" style="background: #25D366; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.275.072.376-.043c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z"/></svg>
                            Confirm & Send Order via WhatsApp
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    checkoutModal.classList.add('active');
    // close cart modal if open
    const cartModal = document.getElementById('cartModal');
    if (cartModal) cartModal.classList.remove('active');
}

function closeCheckoutModal() {
    const checkoutModal = document.getElementById('checkoutModal');
    if (checkoutModal) checkoutModal.classList.remove('active');
}

function copyShopPhone() {
    navigator.clipboard.writeText(SHOP_PHONE);
    showToast(`Copied ${SHOP_PHONE} to clipboard!`);
}

async function handleCheckoutSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('custName').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const city = document.getElementById('custCity').value.trim();
    const address = document.getElementById('custAddress').value.trim();
    const txn = document.getElementById('custTxn').value.trim() || 'Pending/QR Scan Transfer';

    const orderId = 'SHREE-' + Math.floor(100000 + Math.random() * 900000);
    const totalAmount = getCartTotal();

    let itemsListText = cart.map(item =>
        `• ${item.name} (${item.size}, ${item.color}) x${item.quantity} = NPR ${(item.price * item.quantity).toLocaleString('en-IN')}`
    ).join('\n');

    const whatsappMessage =
`🌸 *NEW ORDER - SHREE COLLECTION* 🌸
*Order ID:* ${orderId}

*Customer Details:*
• Name: ${name}
• Phone: ${phone}
• City/District: ${city}
• Delivery Address: ${address}

*Order Items:*
${itemsListText}

*Total Amount:* NPR ${totalAmount.toLocaleString('en-IN')}
*Payment/Txn Ref:* ${txn}

_Please confirm my order and share shipping updates!_ 🙏`;

    // Save order to Supabase (primary source of truth)
    const orderRecord = {
        orderId,
        date: new Date().toLocaleString(),
        name,
        phone,
        city,
        address,
        txn,
        items: [...cart],
        total: totalAmount
    };

    // Call createOrder from db.js - must succeed before clearing cart
    if (typeof createOrder === 'function') {
        const success = await createOrder(orderRecord);
        if (success) {
            // Order saved successfully
            cart = [];
            saveCart();
            closeCheckoutModal();
            showToast('✓ Order saved! Opening WhatsApp...');
            window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMessage)}`, '_blank');
        } else {
            // Order save failed - db.js already showed error
            showToast('❌ Could not save order. Please try again.');
        }
    } else {
        // createOrder not available
        showToast('❌ Database not ready. Please refresh and try again.');
    }
}

// Attach event listeners when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    updateCartUI();

    const cartBtn = document.getElementById('cartBtn');
    const cartModal = document.getElementById('cartModal');
    const closeCartBtn = document.getElementById('closeCartBtn');
    const checkoutBtn = document.getElementById('checkoutBtn');

    if (cartBtn && cartModal) {
        cartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            cartModal.classList.add('active');
        });
    }

    if (closeCartBtn && cartModal) {
        closeCartBtn.addEventListener('click', () => {
            cartModal.classList.remove('active');
        });
    }

    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            openCheckoutModal();
        });
    }

    // Close on outside click
    window.addEventListener('click', (e) => {
        if (e.target === cartModal) {
            cartModal.classList.remove('active');
        }
        const checkoutModal = document.getElementById('checkoutModal');
        if (e.target === checkoutModal) {
            checkoutModal.classList.remove('active');
        }
    });
});
