// ==========================================================================
// SHREE COLLECTION - ADMIN PANEL SCRIPTS
// ==========================================================================

let editingProductId = null;
let uploadedImages = []; // Selected File objects, uploaded to Supabase Storage on submit

document.addEventListener('DOMContentLoaded', () => {
    // Check authentication on page load
    checkAuthentication();
    updateStorageMeter();
});

// ==========================================================================
// STORAGE METER / QUOTA HELPER
// ==========================================================================

function getLocalStorageUsage() {
    let totalBytes = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            totalBytes += (localStorage[key].length + key.length) * 2; // UTF-16 characters = 2 bytes
        }
    }
    const totalMB = totalBytes / (1024 * 1024);
    const maxMB = 5.0; // Standard browser quota is ~5MB
    const percentage = Math.min(100, Math.round((totalMB / maxMB) * 100));

    return {
        usedMB: totalMB.toFixed(2),
        maxMB: maxMB.toFixed(1),
        percentage: percentage
    };
}

function updateStorageMeter() {
    const meterEl = document.getElementById('storageUsageMeter');
    const barEl = document.getElementById('storageProgressBar');
    const textEl = document.getElementById('storageUsageText');

    if (!meterEl || !barEl || !textEl) return;

    const usage = getLocalStorageUsage();
    textEl.textContent = `${usage.usedMB} MB / ${usage.maxMB} MB (${usage.percentage}%)`;
    barEl.style.width = `${usage.percentage}%`;

    if (usage.percentage > 80) {
        barEl.style.background = '#DC2626'; // Red
        meterEl.style.borderColor = '#DC2626';
    } else if (usage.percentage > 50) {
        barEl.style.background = '#F59E0B'; // Amber
        meterEl.style.borderColor = '#F59E0B';
    } else {
        barEl.style.background = '#10B981'; // Green
        meterEl.style.borderColor = 'var(--border-color)';
    }
}

// ==========================================================================
// IMAGE UPLOAD HANDLER
// ==========================================================================

function handleImageUpload(event) {
    const files = event.target.files;
    const previewContainer = document.getElementById('uploadedImagesPreviews');

    if (files.length === 0) return;

    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) {
            alert('Please upload only image files');
            return;
        }

        // Max 5MB per image (Supabase Storage default limit is generous vs. localStorage)
        if (file.size > 5 * 1024 * 1024) {
            alert(`${file.name} is too large. Please use images under 5MB.`);
            return;
        }

        // Keep the real File object for upload; use a blob URL only for the preview
        uploadedImages.push(file);
        const objectUrl = URL.createObjectURL(file);
        const index = uploadedImages.length - 1;

        const preview = document.createElement('div');
        preview.style.cssText = 'position: relative; width: 80px; height: 80px;';
        preview.innerHTML = `
            <img src="${objectUrl}" alt="Selected product image ${index + 1}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);">
            <button type="button" aria-label="Remove selected image ${index + 1}" onclick="removeUploadedImage(${index})" style="position: absolute; top: -6px; right: -6px; background: #DC2626; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;">×</button>
        `;
        previewContainer.appendChild(preview);
    });
}

function removeUploadedImage(index) {
    uploadedImages.splice(index, 1);

    // Refresh preview display
    const previewContainer = document.getElementById('uploadedImagesPreviews');
    previewContainer.innerHTML = '';

    uploadedImages.forEach((file, idx) => {
        const objectUrl = URL.createObjectURL(file);
        const preview = document.createElement('div');
        preview.style.cssText = 'position: relative; width: 80px; height: 80px;';
        preview.innerHTML = `
            <img src="${objectUrl}" alt="Selected product image ${idx + 1}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);">
            <button type="button" aria-label="Remove selected image ${idx + 1}" onclick="removeUploadedImage(${idx})" style="position: absolute; top: -6px; right: -6px; background: #DC2626; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;">×</button>
        `;
        previewContainer.appendChild(preview);
    });
}

function clearUploadedImages() {
    uploadedImages = [];
    const previewContainer = document.getElementById('uploadedImagesPreviews');
    if (previewContainer) {
        previewContainer.innerHTML = '';
    }
    const fileInput = document.getElementById('productImageUpload');
    if (fileInput) {
        fileInput.value = '';
    }
}

// ==========================================================================
// AUTHENTICATION SYSTEM
// ==========================================================================

function checkAuthentication() {
    const isAuthenticated = sessionStorage.getItem('shree_admin_auth') === 'true';

    if (isAuthenticated) {
        showAdminDashboard();
    } else {
        showLoginModal();
    }
}

function showLoginModal() {
    document.getElementById('adminLoginModal').style.display = 'flex';
    document.getElementById('adminDashboardContent').style.display = 'none';
}

function showAdminDashboard() {
    document.getElementById('adminLoginModal').style.display = 'none';
    document.getElementById('adminDashboardContent').style.display = 'block';

    // Load all data
    loadProductsList();
    loadOrdersList();
    loadCurrentQR();
    loadHeritagePreview();

    // Product form submission
    const productForm = document.getElementById('productForm');
    if (productForm && !productForm.dataset.listenerAttached) {
        productForm.addEventListener('submit', handleProductSubmit);
        productForm.dataset.listenerAttached = 'true';
    }
}

async function handleAdminLogin(event) {
    event.preventDefault();

    const enteredPassword = document.getElementById('adminPasswordInput').value;
    const errorEl = document.getElementById('loginErrorMsg');

    // Try Vercel Serverless Function first
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: enteredPassword })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                sessionStorage.setItem('shree_admin_auth', 'true');
                if (data.token) sessionStorage.setItem('shree_admin_token', data.token);
                errorEl.style.display = 'none';
                showAdminDashboard();
                return;
            }
        }
    } catch (e) {
        // If API fails (e.g. running via file:// or static local preview), fallback to localStorage/default
        console.log('Serverless login endpoint unavailable, using local authentication fallback.');
    }

    // Local fallback for offline/static file viewing
    const storedPassword = localStorage.getItem('shree_admin_password') || 'shree2026';

    if (enteredPassword === storedPassword) {
        sessionStorage.setItem('shree_admin_auth', 'true');
        errorEl.style.display = 'none';
        showAdminDashboard();
    } else {
        errorEl.style.display = 'block';
        document.getElementById('adminPasswordInput').value = '';
        document.getElementById('adminPasswordInput').focus();
    }
}

function handleAdminLogout() {
    if (confirm('Are you sure you want to logout from the admin panel?')) {
        sessionStorage.removeItem('shree_admin_auth');
        sessionStorage.removeItem('shree_admin_token');
        window.location.reload();
    }
}

function handleChangePassword(event) {
    event.preventDefault();

    const currentPass = document.getElementById('currentPass').value;
    const newPass = document.getElementById('newPass').value;
    const storedPassword = localStorage.getItem('shree_admin_password') || 'shree2026';

    if (currentPass !== storedPassword) {
        alert('Current password is incorrect!');
        return;
    }

    if (newPass.length < 4) {
        alert('New password must be at least 4 characters long!');
        return;
    }

    localStorage.setItem('shree_admin_password', newPass);
    showToast('Password updated locally! (Note: In production on Vercel, set ADMIN_PASSWORD env variable)');

    document.getElementById('currentPass').value = '';
    document.getElementById('newPass').value = '';
}

// Tab Switching
function switchTab(tabName, evt) {
    // Hide all panels
    document.querySelectorAll('.admin-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    // Remove active from all tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Activate selected panel and tab
    document.getElementById(tabName + 'Panel').classList.add('active');
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }

    // Reload data if needed
    if (tabName === 'products') loadProductsList();
    if (tabName === 'orders') loadOrdersList();
    if (tabName === 'qr') loadCurrentQR();
}

// ==========================================================================
// PRODUCT MANAGEMENT
// ==========================================================================

async function handleProductSubmit(e) {
    e.preventDefault();

    try {
        // Check if form elements exist
        const nameEl = document.getElementById('productName');
        const priceEl = document.getElementById('productPrice');
        const descEl = document.getElementById('productDescription');
        const sizesEl = document.getElementById('productSizes');
        const colorsEl = document.getElementById('productColors');
        const imagesEl = document.getElementById('productImages');
        const featuredEl = document.getElementById('productFeatured');

        if (!nameEl || !priceEl || !descEl || !sizesEl || !colorsEl || !imagesEl) {
            showToast('❌ Form elements missing');
            return;
        }

        // Collect image URLs: pasted URLs first, then files uploaded to Supabase Storage
        const urlImages = imagesEl.value.split(',').map(i => i.trim()).filter(Boolean);
        let imageUrls = [...urlImages];

        if (uploadedImages.length > 0) {
            const submitBtn = document.querySelector('#productForm button[type="submit"]');
            const originalBtnText = submitBtn ? submitBtn.textContent : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Uploading images…';
            }

            try {
                for (let i = 0; i < uploadedImages.length; i++) {
                    const file = uploadedImages[i];
                    const result = await uploadImage(file);

                    // uploadImage returns {url, error} — surface the real Storage error
                    if (!result || result.error) {
                        const msg = result?.error || 'unknown error';
                        showToast(`❌ Image ${i + 1} (${file.name}) failed to upload: ${msg}`);
                        console.error('Storage upload failed:', msg);
                        return; // Do NOT save the product without its image
                    }
                    imageUrls.push(result.url);
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
            }
        }

        const productData = {
            name: nameEl.value.trim(),
            price: parseInt(priceEl.value.trim().replace(/,/g,'')) || 0,
            original_price: document.getElementById('productOriginalPrice')?.value ? parseInt(document.getElementById('productOriginalPrice').value.trim().replace(/,/g,'')) || null : null,
            description: descEl.value.trim(),
            sizes: sizesEl.value.split(',').map(s => s.trim()).filter(Boolean),
            colors: colorsEl.value.split(',').map(c => c.trim()).filter(Boolean),
            images: imageUrls,
            featured: featuredEl ? featuredEl.checked : false,
            in_stock: true
        };

        if (editingProductId) {
            const result = await updateProduct(editingProductId, productData);
            if (result) {
                showToast('✓ Product updated successfully!');
                resetProductForm();
                // Force bypass cache when reloading after update
                setTimeout(() => {
                    window.location.reload(true);
                }, 1000);
            } else {
                showToast('❌ Failed to update product');
            }
        } else {
            // For new products: generate ID synchronously using existing data if available
            const result = await addProduct({
                ...productData,
                id: (typeof productsCache !== 'undefined' && productsCache && productsCache.length > 0)
                    ? Math.max(...productsCache.map(p => p.id)) + 1
                    : Date.now()
            });

            if (result) {
                showToast('✓ New product added successfully!');
                resetProductForm();
                // Force bypass cache when reloading after add
                setTimeout(() => {
                    window.location.reload(true);
                }, 1000);
            } else {
                showToast('❌ Failed to add product');
            }
        }
    } catch (err) {
        console.error('Error submitting product:', err);
        showToast('❌ Error saving product: ' + err.message);
    }
}

async function loadProductsList() {
    const productsList = document.getElementById('productsList');

    // Show loading state
    productsList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">Loading products...</p>';

    const allProducts = await getProducts();

    if (allProducts.length === 0) {
        productsList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No products yet. Add your first product above!</p>';
        return;
    }

    productsList.innerHTML = allProducts.map(product => `
        <div class="product-list-item">
            <img src="${(Array.isArray(product.images) && product.images[0]) ? product.images[0] : PLACEHOLDER_IMAGE}" alt="${product.name}" class="product-list-img">
            <div class="product-list-info">
                <h4 style="font-size: 1.05rem; color: var(--text-dark); margin-bottom: 4px;">${product.name}</h4>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">
                    ${product.sizes.join(', ')}
                </p>
                <p style="font-size: 0.95rem; font-weight: 700; color: var(--primary);">
                    NPR ${product.price.toLocaleString('en-IN')}
                    ${product.original_price ? `<span style="text-decoration: line-through; color: var(--text-muted); font-weight: 400; margin-left: 8px;">NPR ${product.original_price.toLocaleString('en-IN')}</span>` : ''}
                </p>
                ${product.featured ? '<span style="font-size: 0.75rem; background: var(--gold); color: #FFF; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-top: 4px;">FEATURED</span>' : ''}
            </div>
            <div class="product-list-actions">
                <button class="btn-edit" onclick="editProduct(${product.id})">Edit</button>
                <button class="btn-delete" onclick="deleteProductHandler(${product.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

async function editProduct(id) {
    const product = await getProductById(id);
    if (!product) {
        showToast('❌ Product not found');
        return;
    }

    editingProductId = id;

    try {
        const nameEl = document.getElementById('productName');
        if (!nameEl) {
            showToast('❌ Form elements not ready');
            return;
        }

        nameEl.value = product.name;
        document.getElementById('productPrice').value = product.price;
        const origPriceEl = document.getElementById('productOriginalPrice');
        if (origPriceEl) origPriceEl.value = product.original_price || '';
        document.getElementById('productDescription').value = product.description;
        document.getElementById('productSizes').value = product.sizes.join(', ');
        document.getElementById('productColors').value = product.colors.join(', ');
        document.getElementById('productImages').value = product.images.join(', ');
        document.getElementById('productFeatured').checked = product.featured;

        const form = document.getElementById('productForm');
        if (form) {
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        showToast('Editing: ' + product.name);
    } catch (err) {
        console.error('Error editing product:', err);
        showToast('❌ Error loading form');
    }
}

async function deleteProductHandler(id) {
    const product = await getProductById(id);
    if (!product) {
        showToast('❌ Product not found');
        return;
    }

    if (!confirm(`Are you sure you want to delete "${product.name}"? This action cannot be undone.`)) {
        return;
    }

    const success = await deleteProduct(id);
    if (success) {
        showToast('Product deleted successfully');
        loadProductsList();
    } else {
        showToast('❌ Failed to delete product');
    }
}

function resetProductForm() {
    editingProductId = null;
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
    clearUploadedImages();
}

// ==========================================================================
// ORDERS MANAGEMENT
// ==========================================================================

async function loadOrdersList() {
    const ordersList = document.getElementById('ordersList');

    // Show loading state
    ordersList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">Loading orders...</p>';

    const orders = await getOrders();

    if (orders.length === 0) {
        ordersList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No orders yet. Orders will appear here once customers complete checkout.</p>';
        return;
    }

    ordersList.innerHTML = orders.map(order => `
        <div class="order-item">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                <div>
                    <h4 style="font-size: 1rem; color: var(--primary); font-weight: 700;">${order.order_id}</h4>
                    <p style="font-size: 0.85rem; color: var(--text-muted);">${new Date(order.created_at).toLocaleString()}</p>
                </div>
                <div style="text-align: right;">
                    <p style="font-size: 1.15rem; font-weight: 700; color: var(--text-dark);">NPR ${order.total.toLocaleString('en-IN')}</p>
                </div>
            </div>

            <div style="border-top: 1px solid var(--border-color); padding-top: 12px;">
                <p style="font-size: 0.9rem; margin-bottom: 4px;"><strong>Customer:</strong> ${order.name}</p>
                <p style="font-size: 0.9rem; margin-bottom: 4px;"><strong>Phone:</strong> ${order.phone}</p>
                <p style="font-size: 0.9rem; margin-bottom: 4px;"><strong>Address:</strong> ${order.address}, ${order.city}</p>
                <p style="font-size: 0.9rem; margin-bottom: 8px;"><strong>Payment Ref:</strong> ${order.txn}</p>

                <details style="margin-top: 12px;">
                    <summary style="cursor: pointer; font-weight: 600; font-size: 0.9rem; color: var(--primary);">View Order Items (${order.items.length})</summary>
                    <ul style="margin: 8px 0 0 20px; font-size: 0.85rem; color: var(--text-dark);">
                        ${order.items.map(item => `
                            <li>${item.name} (${item.size}, ${item.color}) x${item.quantity} - NPR ${(item.price * item.quantity).toLocaleString('en-IN')}</li>
                        `).join('')}
                    </ul>
                </details>
            </div>

            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <a href="https://wa.me/977${order.phone}?text=${encodeURIComponent('Hello ' + order.name + ', your order ' + order.order_id + ' is being processed!')}"
                   class="btn-edit" style="text-decoration: none; display: inline-block;" target="_blank">
                    Contact Customer
                </a>
                <button class="btn-delete" onclick="deleteOrder(${order.id})">Delete Order</button>
            </div>
        </div>
    `).join('');
}

async function deleteOrder(orderId) {
    if (!confirm('Are you sure you want to delete this order from the history?')) {
        return;
    }

    if (!isSupabaseReady()) {
        showToast('❌ Database not ready');
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('orders')
            .delete()
            .eq('id', orderId);

        if (error) throw error;
        showToast('Order deleted from history');
        loadOrdersList();
    } catch (err) {
        console.error('❌ Error deleting order:', err);
        showToast('❌ Failed to delete order');
    }
}

// ==========================================================================
// QR CODE SETTINGS
// ==========================================================================

function loadCurrentQR() {
    // QR code is now loaded from local assets/qr-code.png file
    // No localStorage needed - just display the current file
    const currentQRImg = document.getElementById('currentQR');
    if (currentQRImg) {
        currentQRImg.src = 'assets/qr-code.png?' + Date.now(); // Cache bust
    }
}

// ==========================================================================
// HERITAGE IMAGE MANAGEMENT
// ==========================================================================

function handleHeritageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        alert('Image is too large. Please use images under 2MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Image = e.target.result;
        localStorage.setItem('shree_heritage_image', base64Image);
        updateStorageMeter();
        showToast('Heritage image uploaded successfully!');
        loadHeritagePreview();
    };
    reader.readAsDataURL(file);
}

function loadHeritagePreview() {
    const preview = document.getElementById('heritagePreview');
    const noImage = document.getElementById('heritageNoImage');
    const savedImage = localStorage.getItem('shree_heritage_image');

    if (savedImage && preview && noImage) {
        preview.src = savedImage;
        preview.style.display = 'block';
        noImage.style.display = 'none';
    } else if (preview && noImage) {
        preview.style.display = 'none';
        noImage.style.display = 'block';
    }
}

function removeHeritageImage() {
    if (!confirm('Are you sure you want to remove the heritage image?')) {
        return;
    }
    localStorage.removeItem('shree_heritage_image');
    updateStorageMeter();
    showToast('Heritage image removed');
    loadHeritagePreview();
}

// ==========================================================================
// PRODUCT CATALOG RESET
// ==========================================================================

function resetProductCatalog() {
    if (!confirm('Are you sure you want to reset the product catalog?\n\nThis will remove all custom products you added and reload the default catalog from the database.')) {
        return;
    }

    localStorage.removeItem('shree_collection_products');
    showToast('Product catalog reset! Page will reload in 2 seconds...');

    setTimeout(() => {
        window.location.reload();
    }, 2000);
}