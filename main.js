// ==========================================================================
// SHREE COLLECTION - MAIN SCRIPTS (Home page & Global)
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    initHomePage();
    initMobileMenu();
    initScrollAnimations();
});

// Home Page Featured Products
async function initHomePage() {
    const featuredGrid = document.getElementById('featuredProducts');
    if (!featuredGrid) return;

    // Show loading state
    featuredGrid.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">Loading products...</p>';

    const featured = await getFeaturedProducts();

    if (featured.length === 0) {
        featuredGrid.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No featured products available</p>';
        return;
    }

    featuredGrid.innerHTML = featured.map(product => createProductCard(product)).join('');
}

// Create Product Card HTML
function createProductCard(product) {
    const discount = product.original_price
        ? Math.round(((product.original_price - product.price) / product.original_price) * 100)
        : 0;

    return `
        <div class="product-card">
            <div class="product-image-wrap">
                <img src="${product.images[0]}" alt="${product.name}" loading="lazy">
                ${product.featured ? '<div class="product-badge">Featured</div>' : ''}
                ${discount > 0 ? `<div class="product-discount-badge">-${discount}%</div>` : ''}
                <button class="product-quick-view-btn" onclick="window.location.href='product.html?id=${product.id}'">
                    View Details
                </button>
            </div>
            <div class="product-info">
                <a href="product.html?id=${product.id}" class="product-title">${product.name}</a>
                <div class="product-prices">
                    <span class="current-price">NPR ${product.price.toLocaleString('en-IN')}</span>
                    ${product.original_price ? `<span class="original-price">NPR ${product.original_price.toLocaleString('en-IN')}</span>` : ''}
                </div>
                <div class="product-colors">
                    ${product.colors.slice(0, 4).map(color => `
                        <span class="color-dot" style="background-color: ${getColorHex(color)};" title="${color}"></span>
                    `).join('')}
                </div>
                <div class="product-actions">
                    <button class="btn-add-cart" onclick="addToCart(${product.id})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                        Add to Cart
                    </button>
                    <a href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi! I want to buy: ' + product.name)}"
                       class="btn-whatsapp-buy" target="_blank" title="Order via WhatsApp">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.275.072.376-.043c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z"/>
                        </svg>
                    </a>
                </div>
            </div>
        </div>
    `;
}

// Color name to hex mapping (basic)
function getColorHex(colorName) {
    const colorMap = {
        'maroon': '#800000',
        'navy blue': '#000080',
        'emerald green': '#50C878',
        'pink': '#FFC0CB',
        'peach': '#FFE5B4',
        'mint green': '#98FF98',
        'red': '#DC143C',
        'magenta': '#FF00FF',
        'golden': '#FFD700',
        'white': '#FFFFFF',
        'yellow': '#FFFF00',
        'light blue': '#ADD8E6',
        'black': '#000000',
        'wine': '#722F37',
        'royal blue': '#4169E1',
        'green': '#008000',
        'orange': '#FFA500'
    };
    return colorMap[colorName.toLowerCase()] || '#CCCCCC';
}

// Mobile Menu Toggle
function initMobileMenu() {
    const mobileBtn = document.getElementById('mobileMenuBtn');
    const navLinks = document.querySelector('.nav-links');

    if (mobileBtn && navLinks) {
        mobileBtn.addEventListener('click', () => {
            navLinks.classList.toggle('mobile-active');
            mobileBtn.classList.toggle('active');
        });
    }
}

// Scroll Animations with Intersection Observer
function initScrollAnimations() {
    const animatedElements = document.querySelectorAll('.product-card, .trust-item');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, index * 80);
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// Smooth Scroll for anchor links (only internal anchors, skip external links)
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        // Skip if this is an external link that was set by config.js
        if (href === '#' || href.includes('wa.me') || href.includes('http')) {
            return;
        }
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Navbar scroll effect
let lastScroll = 0;
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
        navbar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
    } else {
        navbar.style.boxShadow = 'none';
    }

    lastScroll = currentScroll;
});

// Load Heritage Image from localStorage
function loadHeritageImage() {
    const heritageImg = document.getElementById('heritageImage');
    const placeholder = document.getElementById('heritageImagePlaceholder');

    if (!heritageImg || !placeholder) return;

    const savedImage = localStorage.getItem('shree_heritage_image');

    if (savedImage) {
        heritageImg.src = savedImage;
        heritageImg.style.display = 'block';
        placeholder.style.display = 'none';
    }
}

// Call on page load
if (document.getElementById('heritageImage')) {
    loadHeritageImage();
}

