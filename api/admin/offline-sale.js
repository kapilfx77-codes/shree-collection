// ============================================================================
// /api/admin/offline-sale — record a sale outside the website
// ============================================================================
// Admin selects product + color + size + qty + amount paid + source.
// Uses same FIFO batches (consume_fifo_batches / restore_fifo_batches) and
// same inventory decrement mechanism as online orders. Writes to orders
// table with source tag and computed profit = paid - FIFO cost.
// ============================================================================

import { requireAdmin, sbFetch, requireServiceKey, ALLOWED_SALES_SOURCES } from '../../lib/admin-auth.js';

const MAX_PER_LINE = Number(process.env.INVENTORY_PER_ITEM_CAP || 10);

function colorKey(v) { return String(v || '').trim(); }

export default async function handler(req, res) {
  if (requireServiceKey(res)) return;
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};

    const productId = Number(body.product_id || body.productId);
    const color = colorKey(body.color);
    const size = colorKey(body.size);
    const quantity = Math.floor(Number(body.quantity || 1));
    const amountPaid = Math.round(Number(body.amount_paid || body.amountPaid || 0) * 100) / 100;
    const source = String(body.source || 'physical').trim().toLowerCase();

    if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Valid product_id required' });
    if (!color) return res.status(400).json({ error: 'Color required' });
    if (!size) return res.status(400).json({ error: 'Size required' });
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_PER_LINE) return res.status(400).json({ error: 'Valid quantity 1-' + MAX_PER_LINE + ' required' });
    if (!Number.isFinite(amountPaid) || amountPaid < 0) return res.status(400).json({ error: 'Valid amount_paid required' });

    // Re-read product
    const pr = await sbFetch(`products?select=id,name,price,in_stock,sizes,colors&id=eq.${productId}`);
    if (pr.status >= 400) return res.status(500).json({ error: 'Could not load product' });
    const product = Array.isArray(pr.data) ? pr.data[0] : null;
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.in_stock === false) return res.status(409).json({ error: 'Product out of stock' });

    // Validate variant exists in DB
    if (Array.isArray(product.sizes) && product.sizes.length > 0 && !product.sizes.includes(size)) {
      return res.status(409).json({ error: 'Size not available for this product' });
    }
    if (Array.isArray(product.colors) && product.colors.length > 0 && !product.colors.includes(color)) {
      return res.status(409).json({ error: 'Color not available for this product' });
    }

    // Soft inventory pre-check
    const inv = await sbFetch(`inventory?select=product_id,color,size,quantity&product_id=eq.${productId}&color=eq.${encodeURIComponent(color)}&size=eq.${encodeURIComponent(size)}`);
    const invRow = (Array.isArray(inv.data) && inv.data[0]) ? inv.data[0] : null;
    if (!invRow) return res.status(409).json({ error: 'Variant not found in inventory' });
    const onHand = Number(invRow.quantity || 0);
    if (onHand < quantity) {
      return res.status(409).json({ error: `Only ${onHand} available. Please reduce quantity.`, available: onHand, requested: quantity });
    }

    // Generate order id
    function genOrderId() {
      return `OFFLINE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    }
    let orderId = null;
    for (let a = 0; a < 3; a++) {
      const c = genOrderId();
      const e = await sbFetch(`orders?order_id=eq.${encodeURIComponent(c)}&select=order_id`);
      if (e.status === 200 && Array.isArray(e.data) && e.data.length === 0) { orderId = c; break; }
    }
    if (!orderId) return res.status(500).json({ error: 'Could not generate unique order id' });

    const now = new Date().toISOString();
    const insertPayload = {
      order_id: orderId,
      name: 'Offline Sale — ' + (session?.email || session?.name || 'Admin'),
      phone: '0000000000',
      city: 'Butwal',
      address: 'Offline / ' + source,
      items: [{ id: productId, name: product.name, price: Number(product.price), size, color, quantity }],
      total: Number(product.price) * quantity,
      status: 'completed',
      payment_method: 'offline',
      payment_status: 'paid',
      txn: source,
      source: source,
      amount_paid: amountPaid,
      created_at: now,
    };

    const ins = await sbFetch('orders?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(insertPayload),
    });
    if (ins.status >= 400) return res.status(500).json({ error: 'Could not save order', detail: ins.data || ins.raw });
    const row = (Array.isArray(ins.data) && ins.data[0]) || null;

    // Consume FIFO batches (same as online order)
    const batchAllocations = [];
    let lineCost = 0;
    const rc = await sbFetch('rpc/consume_fifo_batches', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        p_product_id: productId,
        p_color: color,
        p_size: size,
        p_qty: quantity,
      }),
    });
    if (rc.status >= 400) {
      // Soft-cancel order, restore nothing yet
      if (row && row.order_id) {
        await sbFetch(`orders?order_id=eq.${encodeURIComponent(row.order_id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ status: 'cancelled', payment_status: 'failed', payment_rejection_reason: 'FIFO consumption failed' }),
        });
      }
      return res.status(409).json({ error: 'FIFO consumption failed. Inventory may have changed.', code: 'fifo_failed' });
    }
    const rows = Array.isArray(rc.data) ? rc.data : [];
    if (rows.length === 0) {
      if (row && row.order_id) await sbFetch(`orders?order_id=eq.${encodeURIComponent(row.order_id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled', payment_status: 'failed', payment_rejection_reason: 'Insufficient FIFO batches' }) });
      return res.status(409).json({ error: 'Insufficient FIFO batches for this sale.', code: 'insufficient_batch' });
    }
    const lastRow = rows[rows.length - 1];
    if (lastRow && lastRow.total_cost === -1) {
      if (row && row.order_id) await sbFetch(`orders?order_id=eq.${encodeURIComponent(row.order_id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled', payment_status: 'failed', payment_rejection_reason: 'FIFO rolled back (insufficient)' }) });
      return res.status(409).json({ error: 'Not enough stock in FIFO batches.', code: 'insufficient_stock' });
    }
    for (const r of rows) {
      if (r.batch_id != null) batchAllocations.push({ batch_id: r.batch_id, allocated_qty: r.allocated_qty });
      if (r.total_cost != null) lineCost = Number(r.total_cost) || 0;
    }

    // Update order with FIFO allocations + cost + profit
    const profit = Math.round((amountPaid - lineCost) * 100) / 100;
    if (batchAllocations.length > 0) {
      await sbFetch(`orders?order_id=eq.${encodeURIComponent(row.order_id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          batch_allocations: batchAllocations,
          total_cost: lineCost,
          amount_paid: amountPaid,
          profit: profit,
        }),
      });
    }

    return res.status(201).json({
      ok: true,
      order_id: orderId,
      product: product.name,
      quantity,
      amount_paid: amountPaid,
      fifo_cost: lineCost,
      profit,
      source,
      status: 'completed',
    });
  } catch (err) {
    console.error('offline-sale error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
