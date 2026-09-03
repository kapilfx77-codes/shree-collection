# SHREE COLLECTION - SESSION HANDOFF
Project: shree-collection e-commerce (Supabase + Vercel + GitHub)
Repository: D:\Shree Website | GitHub: kapilfx77-codes/shree-collection
Website: https://shree-collection-opal.vercel.app/
Last Updated: 2026-09-03

## ARCHITECTURE
- **Frontend**: Static HTML/CSS/JS (vanilla, no framework)
- **Backend**: Supabase (products, orders tables) - NO fallback, NO localStorage
- **Serverless**: Vercel API function at `api/login.js` for admin authentication
- **Deployment**: GitHub → Vercel (automatic deploy on push to main)
- **Scripts**: db.js, admin.js, catalog.js, cart.js, main.js, config.js
- **Config**: config.js (centralized store config)
- **Assets**: assets/qr-code.png, assets/favicon.svg, og-image.png, icons
- **Public**: public/googlec2abaddf7a5c210b.html (Google Search Console verification)

## PAGES/ROUTES
- `/index.html` - Homepage (featured products, about section, Organization + WebSite JSON-LD)
- `/catalog.html` - Product catalog (loads from Supabase, search, filters, sort)
- `/product.html?id=N` - Product detail (query param, dynamic metadata)
- `/contact.html` - Contact page
- `/admin.html` - Admin panel (noindex, protected by password)
- `/api/login` - POST endpoint for admin auth (serverless function)

## SUPABASE SETUP
- Database URL: scngozslllefwivasslu.supabase.co
- Tables: products, orders, inventory
- RLS policies configured
- Storage: product-images bucket (public)
- Products loaded via getProducts() from db.js
- Featured products via getFeaturedProducts() - checks `featured` boolean field

## VERCEL CONFIGURATION (CRITICAL - FIXED 404)
File: vercel.json
```json
{
  "outputDirectory": ".",
  "cleanUrls": true,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
The `outputDirectory: "."` is ESSENTIAL - without it, the site returns 404 because Vercel detects the api/ folder and expects a build output directory.

## SEO IMPLEMENTATION
### Meta Tags (all pages)
- Title, meta description, canonical URL
- Open Graph: og:title, og:description, og:image, og:url, og:type, og:locale
- Twitter Card: summary_large_image
- Theme color

### Structured Data (index.html)
- Organization JSON-LD (name, url, logo, address, contactPoint)
- WebSite JSON-LD with SearchAction (searchAction target: catalog.html?q={q})

### Technical SEO Files
- sitemap.xml: Valid, references homepage, catalog, contact (no broken URLs)
- robots.txt: Valid, allows crawlers, disallows /admin.html and /api/

### Product Images
- Alt text: `${product.name}` (from createProductCard in main.js)
- loading="lazy" attribute
- Placeholder SVG for missing images

## GOOGLE SEARCH CONSOLE
- VERIFIED: public/googlec2abaddf7a5c210b.html exists
- Accessible at: https://shree-collection-opal.vercel.app/googlec2abaddf7a5c210b.html
- Sitemap URL to submit: https://shree-collection-opal.vercel.app/sitemap.xml

## PRODUCTS/CATALOG BEHAVIOR
- Products load ONLY from Supabase (no hardcoded fallback)
- catalog.js fetches from Supabase with cache bypass on page load
- Product detail page uses query parameter (?id=N)
- Featured products section on homepage loads from Supabase (featured=true filter)
- Product images: Unsplash URLs OR Supabase Storage uploads
- Search uses `searchInput` element, filters by name, description, colors
- Price filter: range slider 0-40000 NPR
- Size filter: checkboxes for S, M, L, XL, Free Size
- Sort options: Default, Price Low-High, Price High-Low, Name A-Z

## PAYMENT/WHATSAPP FUNCTIONALITY
- WhatsApp: 9841735450 (standardized)
- QR payment: eSewa/Mobile Banking
- Cart modal with checkout button
- WhatsApp floating button on all pages

## DESIGN/MOBILE
- CSS variables for consistent theming
- Mobile-first responsive breakpoints: 992px, 768px, 480px
- Hamburger menu for mobile navigation
- Product grid adapts to screen size
- Lazy loading images
- Touch-friendly buttons and targets

## COMPLETED WORK
1. Fixed 404 deployment issue (vercel.json outputDirectory)
2. Fixed sitemap.xml (removed non-existent privacy.html and terms.html)
3. Added WebSite JSON-LD schema with SearchAction
4. Google Search Console verification file in place
5. Updated session handoff

## KNOWN ISSUES/LIMITATIONS
- Product pages use query parameters (?id=N) - not ideal for deep SEO indexing
- No Product structured data on product.html yet
- No breadcrumb structured data yet
- Heritage/about section has placeholder image upload feature

## WHAT NOT TO REDO
- Do NOT remove products.js again (already done)
- Do NOT change the phone number from 9841735450
- Do NOT remove Supabase integration
- Do NOT remove WhatsApp functionality
- Do NOT rebuild the website from scratch
- Do NOT change the Vercel configuration outputDirectory
- Do NOT delete public/googlec2abaddf7a5c210b.html
- Do NOT add privacy.html or terms.html to sitemap if they don't exist

## NEXT TASKS (recommended)
1. Add Product structured data to product detail pages
2. Verify mobile responsiveness on all pages
3. Check accessibility on all pages
4. Consider adding breadcrumb structured data
5. Add real products to the database

## GIT STATUS
Branch: main
Latest commit: 0e622dc (SEO improvements: fix sitemap, add WebSite schema, update handoff)
GitHub: up to date with origin/main
