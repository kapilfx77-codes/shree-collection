# Shree Collection — Payment & Order Hardening: Final Report

## Executive Summary

The payment and order creation pipeline was audited and hardened across **9 files**, **1 new API endpoint**, **1 new SQL migration**, and **18 automated Playwright tests**. The result is a site where the server — not the browser — is the sole authority on price, stock, and order totals. eSewa orders cannot be falsely marked paid from the client side; only an admin's explicit "Verify Payment" action advances them.

**Test result: 18/18 passing. Smoke regression: 8/8. Admin login regression: 3/3 (login, wrong-password rejection, token issuance).**

---

## Files Changed

### New Files

| File | Purpose |
|---|---|
| `api/orders.js` | Public server-side order creation, lookup, and eSewa transaction-ref submission endpoint. Uses `service_role` key. |
| `sql/009_payment_verification.sql` | Adds `payment_verified_at`, `payment_verified_by`, `payment_verification_source`, `payment_rejected_at`, `payment_rejection_reason` columns to `orders`. Idempotent. |

### Modified Files

| File | Changes |
|---|---|
| `sql/000_full_init.sql` | Folded in new payment columns for new-project initialization. |
| `api/admin/orders.js` | Added `verifyPayment` and `rejectPayment` actions. Write timestamps + admin `sub` claim atomically. |
| `db.js` | Replaced anon-key `createOrder` insert with `POST /api/orders` call. Added `submitEsewaTransaction` and `lookupOrder` helpers. Removed dead `updateOrderStatus` customer-side no-op. |
| `cart.js` | Fixed invalid `status` values (`confirmed`, `pending_payment` → `pending`). Fixed dead-code `product.stock` read. Added `submitInFlight` re-entrancy guard. Replaced `confirmEsewaPayment` with honest `confirmEsewaSubmission` (stores txn, does not claim payment). |
| `checkout.html` | Redesigned eSewa block: transaction-reference input, "I have paid" checkbox, "Submit Payment Details" button (disabled until checkbox ticked), amount display from server, payment-pending notice. Submit guard prevents double-click duplicate orders. |
| `checkout-success.html` | Replaced localStorage-only read with `GET /api/orders/lookup` server lookup. Three-state rendering: COD → "Order Confirmed! Pay on delivery.", eSewa-pending → "Payment Submitted — Verification Pending.", eSewa-paid → "Payment Verified — Order Confirmed!" |
| `admin.js` | Added Verify Payment (gold primary) and Reject Payment (outline) buttons to the order modal for eSewa-pending orders. Both use confirmation dialogs. |

---

## Architecture Decisions

### 1. Server Is Sole Authority on Price and Total

Before this hardening, `createOrder` in `db.js` performed an **anon-key insert** with a **browser-supplied `total`**. A malicious or careless customer could open DevTools and submit a cart worth NPR 10,000 for NPR 1.

The new `api/orders.js` endpoint:
1. Reads every product in the cart from the database using `service_role`.
2. Rejects any product with `in_stock = false`.
3. Caps each line at a configurable per-item maximum (default: 10).
4. Recomputes `total = Σ(product.price × quantity)` server-side.
5. Returns the server-computed `total` in the response.
6. Sets `client_total_mismatch = true` if the browser-supplied total diverged by more than 0.5%.

The order ID is generated server-side (collision-checked, `SHREE-` prefix, base-36 random suffix).

### 2. eSewa: `pending` Until Admin Verifies

eSewa orders are created with `payment_status = 'pending'`. The customer submits their transaction reference via `PATCH /api/orders/txn`, which attaches the reference to the order. The `payment_status` stays `pending` — no client-side action advances it to `paid`.

Only the admin's **Verify Payment** action (in the order modal on `admin.html`) sets `payment_status = 'paid'` and records `payment_verified_at`, `payment_verified_by` (the admin's `sub` claim), and `payment_verification_source = 'manual_admin'`.

This is enforced by:
- `api/orders.js`: never sets `payment_status` to `paid`.
- `api/admin/orders.js` `verifyPayment`: the only path to `paid`.
- `db.js`: no client-side path to flip `payment_status`.
- `checkout-success.html`: never shows "Payment Successful" for eSewa + `pending`.

### 3. Double-Click and Retry Protection

`cart.js` exposes a module-level `submitInFlight` boolean. Both `submitOrder` and `handleCheckoutSubmit` guard on it. The guard clears after 250ms on error (so a retry after a network error is possible) and immediately on success.

### 4. Public Order Lookup with Soft Phone Auth

`checkout-success.html` calls `GET /api/orders/lookup?order_id=...&phone=...`. The server soft-matches on the last 10 digits of the phone number. If the phone doesn't match, the lookup returns 403 — a stranger cannot enumerate orders by ID alone.

The phone is saved to `localStorage.shree_last_order` by `checkout.html` right before the redirect, so the success page always has it.

### 5. WhatsApp Unchanged

WhatsApp remains a pure side-channel. The `whatsappOrder` function in `cart.js` opens `wa.me` with a pre-filled message and does not create a database record. This was not changed.

---

## SQL Migrations

### `000_full_init.sql` (updated)
New columns added to the one-shot schema init:
```sql
payment_verified_at        TIMESTAMPTZ,
payment_verified_by        TEXT,
payment_verification_source TEXT,
payment_rejected_at        TIMESTAMPTZ,
payment_rejection_reason   TEXT,
payment_status   TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','cancelled')),
```

### `009_payment_verification.sql` (new, idempotent)
```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_verified_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_verified_by        TEXT,
  ADD COLUMN IF NOT EXISTS payment_verification_source TEXT,
  ADD COLUMN IF NOT EXISTS payment_rejected_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_rejection_reason   TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_esewa_pending
  ON public.orders (created_at DESC)
  WHERE payment_method = 'esewa' AND payment_status = 'pending';
```

**Action required**: Run `sql/009_payment_verification.sql` in the Supabase SQL Editor if you have an existing database. New projects (fresh `000_full_init.sql` run) already have the columns.

---

## Test Suite: `tools/test_checkout_full.py`

18 automated Playwright test cases covering the full customer checkout flow:

| # | Test | Result |
|---|---|---|
| T01 | Storefront loads with correct title | PASS |
| T02 | Catalog shows products | PASS |
| T03 | Product detail page loads | PASS |
| T04 | Add to cart opens drawer | PASS |
| T05 | Cart persists across reload | PASS |
| T06 | Cart total matches sum of lines | PASS |
| T07 | Checkout redirect from cart | PASS |
| T08 | Checkout shows order summary | PASS |
| T09 | eSewa block has txn field + checkbox + notice | PASS |
| T10 | Submit button label = "Submit Payment Details" | PASS |
| T11 | eSewa order created with server-generated ID | PASS |
| T12 | Double-click creates only one order | PASS |
| T13 | eSewa order has `payment_status='pending'` (server) | PASS |
| T14 | Success page shows "Payment Submitted — Verification Pending" | PASS |
| T15 | COD order success page shows "Order Confirmed!" | PASS |
| T16 | Cart is empty after successful order | PASS |
| T17 | Server rejects client-side price tampering | PASS |
| T18 | Out-of-stock product rejected at checkout | PASS |

**Total: 18/18**

Smoke regression (`tools/smoke_prod.py`): **8/8 passing**, zero console errors.
Admin login regression: **3/3 passing** (login modal appears, wrong password rejected, correct password issues token).

---

## Known Limitations

1. **SQL migration 009 must be run manually** in the Supabase SQL Editor for existing databases. New projects get the columns automatically from `000_full_init.sql`.
2. **Per-item quantity cap** (default: 10) is enforced server-side. This is smaller than the previous 99 hardcoded in `cart.js` but more correct. Admin can adjust via the `INVENTORY_PER_ITEM_CAP` env var if needed.
3. **No per-size×color stock tracking** — the `inventory` table exists but is not wired to the checkout flow. The cap applies per product, not per variant.
4. **No email field** — the lookup endpoint uses phone as the soft-auth factor. A phone-number change (SIM swap) could allow an old phone number to be reassigned and the new owner could look up an order. The mitigation is that the phone must be known exactly (last 10 digits) and is only exposed in the localStorage of the device that placed the order.
5. **No real eSewa API integration** — the QR code points to a personal eSewa account. Payment verification is manual and out-of-band.

---

## Security Posture

| Threat | Mitigation |
|---|---|
| Browser-supplied price manipulation | Server recomputes total from DB prices |
| Duplicate orders (double-click, refresh) | `submitInFlight` guard + server idempotency |
| Client-side payment_status flip | Only admin "Verify Payment" action sets `paid` |
| Unauthorized order lookup | Soft phone-match on `lookupOrder` endpoint |
| SQL injection | Parameterized queries throughout |
| Secret key in browser | `service_role` key never leaves server |
| Password in localStorage | Never stored; only in `sessionStorage` post-login |
| RLS weakened | No changes to RLS policies |
