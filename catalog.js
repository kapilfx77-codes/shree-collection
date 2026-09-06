// ==========================================================================
// SHREE COLLECTION - CATALOG PAGE SCRIPTS
// ==========================================================================

let allProducts = [];
let filteredProducts = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Load products from database (bypass cache on page load)
    console.log('🔄 Catalog: Loading products from database...');
    allProducts = await getProducts(true); // Force fresh data
    console.log(`📦 Catalog: Loaded ${allProducts.length} products`);

    // Build color filter options from available product colors
    buildColorFilter();

    // Initialize search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(applyFilters, 300));
    }

    // Initialize price range
    const priceRange = document.getElementById('priceRange');
    if (priceRange) {
        priceRange.addEventListener('input', debounce(applyFilters, 300));
    }

    // Initialize sort select
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', applyFilters);
    }

    applyFilters();
});

// Build the color filter panel from all available colors in the catalog.
// Called once after products load; results are stable until a page reload.
function buildColorFilter() {
    const container = document.getElementById('colorFilterOptions');
    if (!container) return;

    // Collect every color across all products, case-insensitively de-duped.
    const seen = new Set();
    const colors = [];
    for (const p of allProducts) {
        if (!p.name) continue; // skip products with null/missing name
        for (const c of (p.colors || [])) {
            if (!c) continue; // skip null/undefined color entries
            const key = String(c).toLowerCase().trim();
            if (key && !seen.has(key)) {
                seen.add(key);
                colors.push(c.trim()); // preserve original casing for display
            }
        }
    }
    colors.sort((a, b) => a.localeCompare(b));

    if (colors.length === 0) {
        container.innerHTML = '<span style="font-size:0.85rem;color:var(--text-muted)">No colors available</span>';
        return;
    }

    container.innerHTML = colors.map(color => `
        <label class="filter-checkbox">
            <input type="checkbox" value="${color.replace(/"/g, '&quot;')}" data-color-filter onchange="applyFilters()">
            <span class="checkbox-custom"></span>
            <span class="color-dot-inline" style="background-color:${getColorHex(color)};"></span>
            ${color}
        </label>
    `).join('');
}

// Apply all active filters and sort
function applyFilters() {
    const searchQuery = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
    const maxPrice = parseInt(document.getElementById('priceRange')?.value || 40000);
    const sortMethod = document.getElementById('sortSelect')?.value || 'default';

    // Get selected sizes
    const selectedSizes = Array.from(document.querySelectorAll('.filter-checkbox input[type="checkbox"]:checked'))
        .map(cb => cb.value);

    // Get selected colors (exclude any non-color checkboxes by checking data-color-filter)
    const selectedColors = Array.from(
        document.querySelectorAll('.filter-checkbox input[data-color-filter][type="checkbox"]:checked')
    ).map(cb => cb.value);

    // Filter products
    filteredProducts = allProducts.filter(product => {
        // Price filter
        if (product.price > maxPrice) {
            return false;
        }

        // Size filter
        if (selectedSizes.length > 0) {
            const hasMatchingSize = selectedSizes.some(size => (product.sizes || []).includes(size));
            if (!hasMatchingSize) {
                return false;
            }
        }

        // Color filter
        if (selectedColors.length > 0) {
            const hasMatchingColor = selectedColors.some(color =>
                (product.colors || []).some(pc => pc.toLowerCase() === color.toLowerCase())
            );
            if (!hasMatchingColor) {
                return false;
            }
        }

        // Search filter
        if (searchQuery) {
            const matchesSearch =
                (product.name || '').toLowerCase().includes(searchQuery) ||
                (product.description || '').toLowerCase().includes(searchQuery) ||
                (product.colors || []).some(c => c.toLowerCase().includes(searchQuery));

            if (!matchesSearch) {
                return false;
            }
        }

        return true;
    });

    // Sort products
    switch (sortMethod) {
        case 'price-low':
            filteredProducts.sort((a, b) => a.price - b.price);
            break;
        case 'price-high':
            filteredProducts.sort((a, b) => b.price - a.price);
            break;
        case 'name-az':
            filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
            break;
        default:
            // Keep original order (featured first)
            filteredProducts.sort((a, b) => {
                if (a.featured && !b.featured) return -1;
                if (!a.featured && b.featured) return 1;
                return 0;
            });
    }

    renderCatalog();
}

// Render catalog grid
function renderCatalog() {
    const catalogGrid = document.getElementById('catalogGrid');
    const productCount = document.getElementById('productCount');
    const emptyState = document.getElementById('catalogEmptyState');

    if (!catalogGrid) return;

    if (productCount) {
        productCount.textContent = filteredProducts.length;
    }

    if (filteredProducts.length === 0) {
        catalogGrid.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    catalogGrid.innerHTML = filteredProducts.map(product => createProductCard(product)).join('');

    // Animate cards on render
    const cards = catalogGrid.querySelectorAll('.product-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 50);
    });
}

// Update price label
function updatePriceLabel() {
    const priceRange = document.getElementById('priceRange');
    const priceLabel = document.getElementById('priceLabel');

    if (priceRange && priceLabel) {
        const value = parseInt(priceRange.value);
        priceLabel.textContent = `NPR ${value.toLocaleString('en-IN')}`;
    }

    applyFilters();
}

// Reset all filters
function resetFilters() {
    // Reset search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    // Reset price range
    const priceRange = document.getElementById('priceRange');
    if (priceRange) {
        priceRange.value = 40000;
        updatePriceLabel();
    }

    // Reset size checkboxes
    document.querySelectorAll('.filter-checkbox input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    // Reset sort
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) sortSelect.value = 'default';

    // Reset color checkboxes (they have data-color-filter, other checkboxes don't)
    document.querySelectorAll('.filter-checkbox input[data-color-filter][type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    applyFilters();
    showToast('All filters cleared');
}

// Debounce helper for search/price inputs
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
