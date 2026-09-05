// ==========================================================================
// /api/orders — public storefront order creation + lookup
// ==========================================================================
// This endpoint is the ONLY public write path for the orders table.
// It is reachable by anonymous browsers but runs with the service role
// key so it can:
//   1. Re-read every product the customer claims to be ordering,
//   2. Re-validate stock and recompute the total from the live DB prices,
//   3. Insert the resulting order with a server-issued order_id.
//
// The browser's `total` is treated as advisory: the server's recomputed
// value always wins. A drift > 0.5% is reported in the response so the
// admin can spot tampered carts in the logs.
//
// Routes (all POST/GET/PATCH are dispatched on req.method + req.url):
//   POST /api/orders                       → create order
//   POST /api/orders/lookup                → { order_id, phone } → order view
//   POST /api/orders/txn                   → { order_id, phone, txn } → attach ref
//   GET  /api/orders/lookup?...            → same lookup, GET form
//
// The POST form is used because the admin /api/admin/orders endpoint
// (above) accepts JSON bodies, and matching that keeps the caller code
// uniform. GET /api/orders/lookup is allowed so checkout-success.html
// can use a plain fetch() without a body.
// ==========================================================================

import { sbFetch, requireServiceKey, ALLOWED_PAYMENT_METHODS } from '../lib/admin-auth.js';

const MAX_PER_LINE = Number(process.env.INVENTORY_PER_ITEM_CAP || 10);
const MAX_ITEMS = Number(process.env.ORDER_MAX_ITEMS || 50);

// eSewa transaction reference rules: 4..64 chars, alnum + a small set of
// separators. We accept what the customer types but normalise whitespace
// and reject obvious garbage.
const TXN_RE = /^[A-Za-z0-9 _.\-/]{4,64}$/;

// ID generator — collision-checked against the orders table. Max 3 tries.
function genOrderId() {
  return `SHREE-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

function stripPhone(p) {
  return String(p || '').replace(/\D/g, '').slice(-10);
}

function badRequest(res, message, code = 'invalid_request') {
  return res.status(400).json({ error: message, code });
}

export default async function handler(req, res) {
  if (requireServiceKey(res)) return;

  try {
    const url = req.url || '';
    if (req.method === 'POST' && url.endsWith('/lookup')) {
      return await handleLookup(req, res);
    }
    if (req.method === 'GET' && url.includes('/lookup')) {
      return await handleLookup(req, res);
    }
    if (req.method === 'POST' && url.endsWith('/txn')) {
      return await handleTxn(req, res);
    }
    if (req.method === 'POST' && (url === '/api/orders' || url.endsWith('/api/orders'))) {
      return await handleCreate(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('orders error:', err);
    return res.status(500).json({ error: 'Server error', detail: String((err && err.message) || err) });
  }
}

// -------------------------------------------------------------------------
// POST /api/orders — create order
// -------------------------------------------------------------------------
async function handleCreate(req, res) {
  const body = req.body || {};

  // 1. Validate top-level fields
  const name = String(body.name || '').trim();
  const phone = stripPhone(body.phone);
  const city = String(body.city || '').trim();
  const address = String(body.address || '').trim();
  if (!name) return badRequest(res, 'Name is required', 'missing_name');
  if (phone.length !== 10) return badRequest(res, 'A valid 10-digit phone number is required', 'invalid_phone');
  if (!city) return badRequest(res, 'City is required', 'missing_city');
  if (!address) return badRequest(res, 'Address is required', 'missing_address');

  const paymentMethod = String(body.paymentMethod || '').toLowerCase();
  if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
    return badRequest(res, 'Payment method must be "cod" or "esewa"', 'invalid_payment_method');
  }

  // 2. Validate items array
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return badRequest(res, 'Cart is empty', 'empty_cart');
  }
  if (body.items.length > MAX_ITEMS) {
    return badRequest(res, `Too many items in a single order (max ${MAX_ITEMS})`, 'too_many_items');
  }
  const items = [];
  for (const it of body.items) {
    const id = Number(it && it.id);
    const size = String((it && it.size) || '').trim();
    const color = String((it && it.color) || '').trim();
    const quantity = Math.floor(Number(it && it.quantity));
    if (!Number.isInteger(id) || id <= 0) {
      return badRequest(res, 'Each item needs a valid product id', 'invalid_item_id');
    }
    if (!size) return badRequest(res, 'Each item needs a size', 'missing_size');
    if (!color) return badRequest(res, 'Each item needs a color', 'missing_color');
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return badRequest(res, 'Each item needs a positive quantity', 'invalid_quantity');
    }
    if (quantity > MAX_PER_LINE) {
      return badRequest(res, `Maximum quantity per item is ${MAX_PER_LINE}`, 'quantity_cap');
    }
    items.push({ id, size, color, quantity });
  }

  // Optional eSewa transaction reference attached at order time. The
  // customer can also submit it later via POST /api/orders/txn. Either
  // way, payment_status stays "pending" until admin verifies.
  let txn = null;
  if (paymentMethod === 'esewa' && body.txn) {
    const t = String(body.txn).trim();
    if (t && TXN_RE.test(t)) txn = t;
  }

  // 3. Re-fetch every product the customer referenced.
  const ids = Array.from(new Set(items.map((i) => i.id)));
  const inList = `(${ids.join(',')})`;
  const r = await sbFetch(`products?select=id,name,price,original_price,in_stock,sizes,colors&id=in.${inList}`);
  if (r.status >= 400) {
    return res.status(r.status).json({ error: 'Could not load products', detail: r.data || r.raw });
  }
  const products = Array.isArray(r.data) ? r.data : [];
  if (products.length !== ids.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = ids.filter((i) => !found.has(i));
    return res.status(400).json({ error: 'One or more products are no longer available', missing });
  }
  const byId = new Map(products.map((p) => [p.id, p]));

  // 4. Validate each line against the live row.
  const serverItems = [];
  let subtotal = 0;
  for (const line of items) {
    const p = byId.get(line.id);
    if (!p.in_stock) {
      return res.status(409).json({
        error: `Sorry, "${p.name}" is currently out of stock. Please remove it from your cart.`,
        code: 'out_of_stock',
        product_id: p.id,
      });
    }
    if (Array.isArray(p.sizes) && p.sizes.length > 0 && !p.sizes.includes(line.size)) {
      return res.status(409).json({
        error: `"${p.name}" is not available in size ${line.size}.`,
        code: 'invalid_size',
        product_id: p.id,
      });
    }
    if (Array.isArray(p.colors) && p.colors.length > 0 && !p.colors.includes(line.color)) {
      return res.status(409).json({
        error: `"${p.name}" is not available in colour ${line.color}.`,
        code: 'invalid_color',
        product_id: p.id,
      });
    }
    const lineTotal = Number(p.price) * line.quantity;
    subtotal += lineTotal;
    // Persist the server's view of the line so the order row is always
    // independent of the customer's cart contents. The price stored here
    // is the price at the moment the order was placed.
    serverItems.push({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      size: line.size,
      color: line.color,
      quantity: line.quantity,
    });
  }

  // 5. Compare against the browser's claimed total. Drift > 0.5% is
  // logged via the response flag (caller can record it; admin sees
  // nothing special here because server total always wins).
  const clientTotal = Math.floor(Number(body.total) || 0);
  const serverTotal = subtotal; // shipping is "calculated at delivery" — no surcharge on the order row
  const drift = clientTotal ? Math.abs(clientTotal - serverTotal) / clientTotal : 0;
  const clientTotalMismatch = clientTotal > 0 && drift > 0.005;

  // 6. Generate a unique order_id (retry on collision).
  let orderId = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = genOrderId();
    // eslint-disable-next-line no-await-in-loop
    const exists = await sbFetch(`orders?order_id=eq.${encodeURIComponent(candidate)}&select=order_id`);
    if (exists.status === 200 && Array.isArray(exists.data) && exists.data.length === 0) {
      orderId = candidate;
      break;
    }
  }
  if (!orderId) {
    return res.status(500).json({ error: 'Could not generate a unique order id. Please try again.' });
  }

  // 7. Insert via service role.
  const now = new Date().toISOString();
  const insertPayload = {
    order_id: orderId,
    name,
    phone,
    city,
    address,
    items: serverItems,
    total: serverTotal,
    status: 'pending',
    payment_method: paymentMethod,
    payment_status: 'pending',
  };
  if (txn) insertPayload.txn = txn;
  if (paymentMethod === 'cod') {
    // Helpful for the admin: a human-readable default for the txn field
    // if the customer never supplied one. The DB column is nullable; we
    // only fill it for COD so the admin can search by "Cash on Delivery".
    insertPayload.txn = 'Cash on Delivery';
  }

  const ins = await sbFetch('orders?select=*', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(insertPayload),
  });
  if (ins.status >= 400) {
    console.error('orders insert failed:', ins.status, ins.data || ins.raw);
    return res.status(ins.status).json({ error: 'Could not save order', detail: ins.data || ins.raw });
  }
  const row = (Array.isArray(ins.data) && ins.data[0]) || null;

  return res.status(201).json({
    ok: true,
    order_id: orderId,
    total: serverTotal,
    client_total_mismatch: clientTotalMismatch,
    payment_method: paymentMethod,
    payment_status: 'pending',
    status: 'pending',
    created_at: row && row.created_at ? row.created_at : now,
  });
}

// -------------------------------------------------------------------------
// POST /api/orders/txn — attach a transaction reference to a pending order
// -------------------------------------------------------------------------
async function handleTxn(req, res) {
  const body = req.body || {};
  const orderId = String(body.order_id || '').trim();
  const phone = stripPhone(body.phone);
  const txn = String(body.txn || '').trim();

  if (!orderId) return badRequest(res, 'order_id is required', 'missing_order_id');
  if (phone.length !== 10) return badRequest(res, 'A valid 10-digit phone number is required', 'invalid_phone');
  if (!TXN_RE.test(txn)) {
    return badRequest(res, 'Transaction reference must be 4–64 characters (letters, numbers, spaces, dashes, dots, or slashes).', 'invalid_txn');
  }

  const r = await sbFetch(`orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
  if (r.status >= 400) return res.status(r.status).json({ error: 'Could not load order', detail: r.data || r.raw });
  if (!Array.isArray(r.data) || r.data.length === 0) {
    return res.status(404).json({ error: 'Order not found', code: 'not_found' });
  }
  const order = r.data[0];

  // Soft auth: phone (last 10 digits) must match the order's phone.
  if (stripPhone(order.phone) !== phone) {
    return res.status(403).json({ error: 'Phone number does not match this order', code: 'phone_mismatch' });
  }

  // Only allow attaching a txn to an eSewa order that is still pending.
  if (order.payment_method !== 'esewa') {
    return res.status(409).json({ error: 'This order is not an eSewa order', code: 'not_esewa' });
  }
  if (order.payment_status && order.payment_status !== 'pending') {
    return res.status(409).json({
      error: `Payment is already ${order.payment_status} and cannot be updated by the customer.`,
      code: 'already_settled',
    });
  }

  const upd = await sbFetch(
    `orders?order_id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ txn }),
    }
  );
  if (upd.status >= 400) {
    return res.status(upd.status).json({ error: 'Could not update transaction reference', detail: upd.data || upd.raw });
  }
  return res.status(200).json({
    ok: true,
    order_id: orderId,
    txn,
    payment_status: 'pending',
    message: 'Transaction reference saved. Payment is pending verification by Shree Collection.',
  });
}

// -------------------------------------------------------------------------
// POST /api/orders/lookup + GET /api/orders/lookup — sanitized order view
// -------------------------------------------------------------------------
async function handleLookup(req, res) {
  // Accept both query (?order_id=...&phone=...) and body for callers
  // that prefer fetch() with JSON.
  const src = req.method === 'GET' ? req.query || {} : req.body || {};
  const orderId = String(src.order_id || '').trim();
  const phone = stripPhone(src.phone);

  if (!orderId) return badRequest(res, 'order_id is required', 'missing_order_id');
  if (phone.length !== 10) return badRequest(res, 'A valid 10-digit phone number is required', 'invalid_phone');

  const r = await sbFetch(`orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
  if (r.status >= 400) return res.status(r.status).json({ error: 'Could not load order', detail: r.data || r.raw });
  if (!Array.isArray(r.data) || r.data.length === 0) {
    return res.status(404).json({ error: 'Order not found', code: 'not_found' });
  }
  const order = r.data[0];
  if (stripPhone(order.phone) !== phone) {
    // Intentionally vague — don't reveal whether the order exists.
    return res.status(404).json({ error: 'Order not found', code: 'not_found' });
  }

  return res.status(200).json({
    order_id: order.order_id,
    name: order.name,
    phone: order.phone,
    city: order.city,
    address: order.address,
    items: order.items,
    total: order.total,
    status: order.status,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    txn: order.txn,
    payment_verified_at: order.payment_verified_at || null,
    payment_rejected_at: order.payment_rejected_at || null,
    created_at: order.created_at,
  });
}
