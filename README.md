# 🌸 Shree Collection - Official Website & Catalog

A luxury e-commerce catalog website built for **Shree Collection** (Butwal, Nepal).

---

## ✨ Features

- **Luxury Boutique Design**: Rich burgundy and gold accents, Playfair Display typography, smooth transitions, and high-end aesthetics.
- **Product Catalog with Dynamic Filters**:
  - Filter by Category (Sarees, Kurtas, Lehengas)
  - Price range slider in NPR
  - Size selection (S, M, L, XL, Free Size)
  - Real-time search by keywords
  - Sort by Price (Low to High, High to Low) and Alphabetical
- **Product Details View (`product.html`)**:
  - Interactive multi-image gallery thumbnail switcher
  - Size and color picker
  - One-click "Add to Cart" or "Order on WhatsApp"
  - Related product recommendations
- **Complete Shopping Cart & QR Payment Checkout (`cart.js`)**:
  - Persistent shopping cart across pages
  - Dynamic QR code generation / upload
  - Pre-filled Phone / Fonepay / eSewa copy button (`9841735450`)
  - Instant order dispatch via WhatsApp (`https://wa.me/9779841735450`) with auto-formatted receipt and order details.
- **Built-in Visual Admin Panel (`admin.html`)**:
  - **Add / Edit / Delete Products**: Modify prices, original discounted prices, descriptions, sizes, colors, and image URLs.
  - **View Customer Orders**: See all orders submitted with customer names, phone numbers, and addresses.
  - **Upload Payment QR Code**: Change the payment QR code image URL shown at checkout anytime.
- **Nepal-Wide Delivery & Trust Badges**:
  - Integrated contact page (`contact.html`) with Google Maps (Butwal), FAQ, and direct WhatsApp chat.

---

## 🚀 How to Run the Website

### Option 1: Open directly in Browser
Simply double-click `index.html` or open it with any web browser (Chrome, Edge, Safari, Firefox).

### Option 2: Run with local server (Optional)
If you have Python installed:
```powershell
python -m http.server 8000
```
Or with Node.js / npx:
```powershell
npx serve
```
Then visit `http://localhost:8000`.

---

## 🛍️ How to Edit Products & QR Code

1. Navigate to **`admin.html`** or click the **"Admin"** button in the navigation bar.
2. In **Manage Products**, you can add new clothing items or click **Edit** on existing items to change prices, descriptions, and images.
3. In **QR Code Settings**, you can paste your actual eSewa/Fonepay QR code image URL.

---

## 📞 Contact Info Configured
- **Phone / WhatsApp**: `9841735450`
- **Location**: Butwal, Rupandehi, Nepal
- **Delivery**: All over Nepal
