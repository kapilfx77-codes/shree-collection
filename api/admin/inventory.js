// ==========================================================================
// /api/admin/inventory — variant-level inventory management
// ==========================================================================
// GET    ?product_id=...  → variants for a product, or 404
// GET    (no params)      → { inventory: [...] } all variants of all products
//                           (joined with product name)
// POST   body: { product_id, color, size, quantity } → UPSERT
// PATCH  body: { product_id, color, size, delta }    → adjust by delta
//                                                           (positive or negative)
//
// The POST path uses `Prefer: resolution=merge-duplicates` so a row
// that already exists has its quantity overwritten with the supplied
// absolute value (admin "set stock to N" semantic). The PATCH path
// uses the atomic `decrement_inventory` / `restore_inventory` RPCs
// from sql/011_variant_inventory.sql so an admin's adjustment can
// never push stock negative.
// ==========================================================================

import { requireAdmin, sbFetch, requireServiceKey } from '../../lib/admin-auth.js';

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    try {
        if (req.method === 'GET') return await handleGet(req, res);
        if (req.method === 'POST') return await handleSet(req, res, session);
        if (req.method === 'PATCH') return await handleAdjust(req, res, session);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin/inventory error:', err);
        return res.status(500).json({ error: 'Server error', detail: String((err && err.message) || err) });
    }
}

// GET /api/admin/inventory
async function handleGet(req, res) {
    const { product_id: productId } = req.query || {};
    const inventoryFilter = productId
        ? `inventory?product_id=eq.${encodeURIComponent(productId)}&select=product_id,color,size,quantity,reserved,available,last_updated&order=color.asc,size.asc`
        : `inventory?select=product_id,color,size,quantity,reserved,available,last_updated&order=product_id.asc,color.asc,size.asc&limit=1000`;

    const invRes = await sbFetch(inventoryFilter);
    if (invRes.status >= 400) {
        return res.status(invRes.status).json(invRes.data || { error: invRes.raw });
    }
    const rows = Array.isArray(invRes.data) ? invRes.data : [];
    if (rows.length === 0) {
        return res.status(200).json({ inventory: [], products: [] });
    }

    // Join with products for a human-readable name. Fetch only the ids
    // that appear in the inventory list — we don't need the full
    // products table.
    const uniqueIds = Array.from(new Set(rows.map((r) => r.product_id)));
    const prodRes = await sbFetch(
        `products?select=id,name,in_stock&id=in.(${uniqueIds.join(',')})`
    );
    const products = Array.isArray(prodRes.data) ? prodRes.data : [];
    const productName = new Map(products.map((p) => [p.id, p]));
    const inventory = rows.map((r) => ({
        ...r,
        product_name: productName.get(r.product_id) ? productName.get(r.product_id).name : null,
        product_in_stock: productName.get(r.product_id) ? !!productName.get(r.product_id).in_stock : null,
    }));
    if (productId) {
        return res.status(200).json({ inventory, product: productName.get(Number(productId)) || null });
    }
    return res.status(200).json({ inventory, products });
}

// POST /api/admin/inventory — absolute set
// Body: { product_id, color, size, quantity }
async function handleSet(req, res, session) {
    const body = req.body || {};
    const productId = Number(body.product_id);
    const color = String(body.color || '').trim();
    const size = String(body.size || '').trim();
    const quantity = Math.floor(Number(body.quantity));
    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'product_id is required and must be a positive integer' });
    }
    if (!color) return res.status(400).json({ error: 'color is required' });
    if (!size) return res.status(400).json({ error: 'size is required' });
    if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'quantity must be a non-negative integer' });
    }

    // UPSERT: prefer=resolution=merge-duplicates ON CONSTRAINT (product_id, color, size)
    // means an existing row gets its quantity overwritten. Quantity is
    // always set absolutely (admin "set to N" semantic), never
    // incremented. This is the right behaviour for an inventory screen.
    const payload = {
        product_id: productId,
        color,
        size,
        quantity,
        reserved: 0,
        last_updated: new Date().toISOString(),
    };
    const r = await sbFetch('inventory?select=product_id,color,size,quantity,reserved,available,last_updated', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(payload),
    });
    if (r.status >= 400) {
        return res.status(r.status).json(r.data || { error: r.raw });
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    return res.status(200).json({ ok: true, row: rows[0] || payload, by: (session && session.sub) || 'admin' });
}

// PATCH /api/admin/inventory — relative adjust
// Body: { product_id, color, size, delta }
async function handleAdjust(req, res, session) {
    const body = req.body || {};
    const productId = Number(body.product_id);
    const color = String(body.color || '').trim();
    const size = String(body.size || '').trim();
    const delta = Math.floor(Number(body.delta));
    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'product_id is required and must be a positive integer' });
    }
    if (!color) return res.status(400).json({ error: 'color is required' });
    if (!size) return res.status(400).json({ error: 'size is required' });
    if (!Number.isInteger(delta) || delta === 0) {
        return res.status(400).json({ error: 'delta must be a non-zero integer (positive to add, negative to remove)' });
    }

    // Use the atomic RPC. Positive delta → restore_inventory; negative
    // delta → decrement_inventory. The CHECK (quantity >= 0) constraint
    // guarantees we can never go negative; an over-decrement attempt
    // raises an error and the RPC returns 4xx.
    const rpc = delta > 0 ? 'restore_inventory' : 'decrement_inventory';
    const qty = Math.abs(delta);
    const r = await sbFetch(`rpc/${rpc}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            p_product_id: productId,
            p_color: color,
            p_size: size,
            p_qty: qty,
        }),
    });
    if (r.status >= 400) {
        // decrement_inventory returns 0 rows when stock would go
        // negative; PostgREST represents that as a 200 with empty
        // array, not an error. The 4xx here is a true failure (RPC
        // raised, e.g. CHECK violation, or the variant row was
        // missing).
        return res.status(r.status).json(r.data || { error: r.raw });
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    if (rows.length === 0) {
        return res.status(409).json({
            error: 'Insufficient stock for this adjustment.',
            code: 'insufficient_stock',
            product_id: productId,
            color,
            size,
            delta,
        });
    }
    return res.status(200).json({ ok: true, row: { product_id: productId, color, size, quantity: rows[0].new_quantity }, by: (session && session.sub) || 'admin' });
}
