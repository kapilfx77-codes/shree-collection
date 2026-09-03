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
- `/index.html` - Homepage (featured products, about section)
- `/catalog.html` - Product catalog (loads from Supabase)
- `/product.html?id=N` - Product detail (query param, dynamic)
- `/contact.html` - Contact page
- `/admin.html` - Admin panel (noindex, protected by password)
- `/api/login` - POST endpoint for admin auth (serverless function)

## SUPABASE SETUP
- Database URL: scngozslllefwivasslu.supabase.co
- Tables: products, orders, inventory
- RLS policies configured
- Storage: product-images bucket (public)
- No anonymous write access (security)

## VERCEL CONFIGURATION (CRITICAL)
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

## PRODUCTS/CATALOG BEHAVIOR
- Products load ONLY from Supabase (no hardcoded fallback)
- catalog.js fetches from Supabase with cache bypass
- Product detail page uses query parameter (?id=N)
- Featured products section on homepage loads from Supabase
- Product images: Unsplash URLs OR Supabase Storage uploads

## PAYMENT/WHATSAPP FUNCTIONALITY
- WhatsApp: 9841735450 (standardized)
- QR payment: eSewa/Mobile Banking
- Cart modal with checkout button
- WhatsApp floating button on all pages

## SEO IMPLEMENTATION
- canonical URL: https://shree-collection-opal.vercel.app/
- Open Graph: og:title, og:description, og:image, og:url
- Twitter Card: summary_large_image
- Organization JSON-LD schema
- sitemap.xml (static, references main pages)
- robots.txt (allows all, disallows /admin.html and /api/)
- Meta descriptions on all pages
- Semantic HTML structure

## GOOGLE SEARCH CONSOLE
- VERIFIED: public/googlec2abaddf7a5c210b.html exists
- Accessible at: https://shree-collection-opal.vercel.app/googlec2abaddf7a5c210b.html
- Sitemap URL to submit: https://shree-collection-opal.vercel.app/sitemap.xml

## TECHNICAL SEO STATUS
- sitemap.xml: VALID, references homepage, catalog, contact
- sitemap.xml also references privacy.html and terms.html (files may not exist - check)
- robots.txt: VALID, allows crawlers, disallows admin and api
- canonical URLs: Set correctly
- noindex/nofollow: Admin panel noindex (correct)

## COMPLETED WORK (from previous sessions)
1. Removed hardcoded products.js - Supabase only
2. Fixed price input (text type prevents scroll changes)
3. Fixed WhatsApp floating button smooth-scroll error
4. Standardized phone to 9841735450
5. Fixed admin.js syntax error (await outside async)
6. Fixed product ID auto-generation
7. Fixed vercel.json outputDirectory (CRITICAL - fixed 404)
8. Added Google Search Console verification file
9. Created sitemap.xml and robots.txt

## KNOWN ISSUES/LIMITATIONS
- sitemap.xml references privacy.html and terms.html (need to verify these exist)
- Product pages use query parameters (?id=N) - may not be ideal for SEO
- No structured data for individual products yet
- No breadcrumb structured data yet
- Heritage/about section has placeholder image

## WHAT NOT TO REDO
- Do NOT remove products.js again (already done)
- Do NOT change the phone number from 9841735450
- Do NOT remove Supabase integration
- Do NOT remove WhatsApp functionality
- Do NOT rebuild the website from scratch
- Do NOT change the Vercel configuration outputDirectory
- Do NOT delete public/googlec2abaddf7a5c210b.html

## NEXT TASKS (recommended)
1. Verify sitemap.xml pages (privacy.html, terms.html) actually exist
2. Add WebSite and SearchAction JSON-LD schema
3. Add Product structured data to product detail pages
4. Improve product images alt text
5. Verify mobile responsiveness on all pages
6. Check accessibility on all pages

## GIT STATUS
Branch: main
Latest commit: 0439973 (Fix vercel.json: set outputDirectory to project root)
GitHub: up to date
