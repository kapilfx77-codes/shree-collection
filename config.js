// ==========================================================================
// SHREE COLLECTION - CENTRALIZED STORE CONFIGURATION
// ==========================================================================
// All store-wide settings in one place. Update values here and they
// propagate across every page automatically.

const STORE_CONFIG = {
    storeName: 'Shree Collection',
    storeNameUpper: 'SHREE COLLECTION',
    tagline: 'Premium women\'s fashion from Butwal, Nepal.',

    // Phone numbers
    primaryPhone: '9841735450',       // Orders, payments, WhatsApp (main)
    secondaryPhone: '9841735450',     // Contact page, customer support

    // WhatsApp (include country code 977)
    whatsappNumber: '9779841735450',
    whatsappNumberSecondary: '9779841735450',

    // Location
    location: {
        short: 'Butwal, Nepal',
        medium: 'Butwal, Rupandehi',
        full: 'Butwal, Rupandehi, Lumbini Province, Nepal',
        mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3532.0!2d83.4596!3d27.6986!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39968b3a44c92e4d%3A0x6f1b8e8c5e7d4c3a!2sRaniganj%2C%20Butwal!5e0!3m2!1sen!2snp!4v1640000000000!5m2!1sen!2snp'
    },

    // Currency
    currency: 'NPR',
    currencyLocale: 'en-IN',

    // Business hours
    businessHours: '9 AM - 8 PM daily',

    // WhatsApp message templates
    messages: {
        heroGreeting: 'Namaste Shree Collection! I would like to see your latest arrivals.',
        generalInquiry: 'Namaste Shree Collection! I have an inquiry about your products.',
        contactInquiry: 'Namaste Shree Collection! I have a question about your products.',
        catalogInquiry: 'Hi Shree Collection! I have a query.',
        productInquiry: 'Hi! I want to buy: ',
    },

    // Year for copyright
    copyrightYear: '2026',
};

// Helper: build a WhatsApp link
function getWhatsAppLink(number, message) {
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// Helper: inject config values into the DOM after page load
function applyStoreConfig() {
    // Store name
    document.querySelectorAll('[data-config="store-name"]').forEach(el => {
        el.textContent = STORE_CONFIG.storeName;
    });
    document.querySelectorAll('[data-config="store-name-upper"]').forEach(el => {
        el.textContent = STORE_CONFIG.storeNameUpper;
    });

    // Phone numbers
    document.querySelectorAll('[data-config="primary-phone"]').forEach(el => {
        el.textContent = STORE_CONFIG.primaryPhone;
    });
    document.querySelectorAll('[data-config="secondary-phone"]').forEach(el => {
        el.textContent = STORE_CONFIG.secondaryPhone;
    });

    // Location
    document.querySelectorAll('[data-config="location-short"]').forEach(el => {
        el.textContent = STORE_CONFIG.location.short;
    });
    document.querySelectorAll('[data-config="location-medium"]').forEach(el => {
        el.textContent = STORE_CONFIG.location.medium;
    });
    document.querySelectorAll('[data-config="location-full"]').forEach(el => {
        el.textContent = STORE_CONFIG.location.full;
    });

    // Copyright
    document.querySelectorAll('[data-config="copyright"]').forEach(el => {
        el.innerHTML = `&copy; ${STORE_CONFIG.copyrightYear} ${STORE_CONFIG.storeName}. All rights reserved.`;
    });

    // WhatsApp floating button
    document.querySelectorAll('[data-config="whatsapp-float"]').forEach(el => {
        const msg = el.dataset.waMessage || STORE_CONFIG.messages.generalInquiry;
        const num = el.dataset.waPhone || STORE_CONFIG.whatsappNumber;
        el.href = getWhatsAppLink(num, msg);
    });

    // WhatsApp CTA links
    document.querySelectorAll('[data-config="whatsapp-link"]').forEach(el => {
        const msg = el.dataset.waMessage || STORE_CONFIG.messages.generalInquiry;
        const num = el.dataset.waPhone || STORE_CONFIG.whatsappNumber;
        el.href = getWhatsAppLink(num, msg);
    });
}

// Auto-apply on DOMContentLoaded
document.addEventListener('DOMContentLoaded', applyStoreConfig);
