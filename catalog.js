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

// Apply all active filters and sort
function applyFilters() {
    const searchQuery = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
    const maxPrice = parseInt(document.getElementById('priceRange')?.value || 40000);
    const sortMethod = document.getElementById('sortSelect')?.value || 'default';

    // Get selected sizes
    const selectedSizes = Array.from(document.querySelectorAll('.filter-checkbox input[type="checkbox"]:checked'))
        .map(cb => cb.value);

    // Filter products
    filteredProducts = allProducts.filter(product => {
        // Price filter
        if (product.price > maxPrice) {
            return false;
        }

        // Size filter
        if (selectedSizes.length > 0) {
            const hasMatchingSize = selectedSizes.some(size => product.sizes.includes(size));
            if (!hasMatchingSize) {
                return false;
            }
        }

        // Search filter
        if (searchQuery) {
            const matchesSearch =
                product.name.toLowerCase().includes(searchQuery) ||
                product.description.toLowerCase().includes(searchQuery) ||
                product.colors.some(c => c.toLowerCase().includes(searchQuery));

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
