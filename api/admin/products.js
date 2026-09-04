// ==========================================================================
// /api/admin/products — admin product management
// ==========================================================================
// GET    ?id=...    → one product or 404
// GET    (no params) → list (paginated, searchable)
// POST   body: product fields → create
// PATCH  body: { id, ...fields } → update
// DELETE body: { id } → soft-disable (in_stock=false) if has orders,
//                       hard delete otherwise. Preserves order history.
// ==========================================================================

import { requireAdmin, sbFetch, requireServiceKey } from '../../lib/admin-auth.js';

const PRODUCT_FIELDS = ['name', 'price', 'original_price', 'description', 'colors', 'sizes',
    'images', 'featured', 'in_stock', 'instock'];

function pickFields(body) {
    const out = {};
    for (const f of PRODUCT_FIELDS) {
        if (body[f] !== undefined) out[f] = body[f];
    }
    return out;
}

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    try {
        if (req.method === 'GET') return await handleGet(req, res);
        if (req.method === 'POST') return await handleCreate(req, res);
        if (req.method === 'PATCH') return await handlePatch(req, res);
        if (req.method === 'DELETE') return await handleSoftDelete(req, res);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin/products error:', err);
        return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
    }
}

async function handleGet(req, res) {
    const { id, search, in_stock, featured, page = '1', pageSize = '100' } = req.query || {};

    if (id) {
        const r = await sbFetch(`products?id=eq.${encodeURIComponent(id)}&select=*`);
        if (r.status !== 200) return res.status(r.status).json(r.data || { error: r.raw });
        if (!r.data || r.data.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(r.data[0]);
    }

    const filters = [];
    if (search) {
        const esc = String(search).replace(/[%_]/g, '\\$&');
        filters.push(`or=(name.ilike.*${esc}*,description.ilike.*${esc}*)`);
    }
    if (in_stock === 'true' || in_stock === 'false') {
        filters.push(`in_stock=eq.${in_stock}`);
    }
    if (featured === 'true' || featured === 'false') {
        filters.push(`featured=eq.${featured}`);
    }
    filters.push('order=id.asc');

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const sizeNum = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 100));
    filters.push(`limit=${sizeNum}`);
    filters.push(`offset=${(pageNum - 1) * sizeNum}`);

    const r = await sbFetch(`products?select=*&${filters.join('&')}`);
    if (r.status !== 200) return res.status(r.status).json(r.data || { error: r.raw });
    return res.status(200).json({ products: r.data || [], page: pageNum, pageSize: sizeNum, returned: (r.data || []).length });
}

async function handleCreate(req, res) {
    const body = req.body || {};
    if (!body.name || typeof body.price !== 'number') {
        return res.status(400).json({ error: 'name and price are required' });
    }
    const payload = pickFields(body);
    if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: 'No product fields supplied' });
    }
    // Default sensible fields
    if (payload.in_stock === undefined && payload.instock === undefined) {
        payload.in_stock = true;
    }
    payload.updated_at = new Date().toISOString();

    const r = await sbFetch('products?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
    });
    if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
    return res.status(201).json({ ok: true, product: (r.data || [])[0] });
}

async function handlePatch(req, res) {
    const body = req.body || {};
    if (!body.id && !body.id_eq) {
        return res.status(400).json({ error: 'id is required' });
    }
    const id = body.id || body.id_eq;
    const payload = pickFields(body);
    if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }
    payload.updated_at = new Date().toISOString();

    const r = await sbFetch(`products?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
    });
    if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
    return res.status(200).json({ ok: true, product: (r.data || [])[0] });
}

async function handleSoftDelete(req, res) {
    const body = req.body || {};
    if (!body.id) return res.status(400).json({ error: 'id is required' });

    // First, check if this product appears in any order.
    // Supabase stores items as a JSONB array; we filter using items->>'contains-product-id'
    // (a JSONB containment filter via the `cs` operator). To keep things simple
    // and safe, fetch the order list and search in the application.
    const ordersRes = await sbFetch('orders?select=id,items');
    let hasOrder = false;
    if (Array.isArray(ordersRes.data)) {
        hasOrder = ordersRes.data.some(o => Array.isArray(o.items) && o.items.some(i => Number(i.id) === Number(body.id)));
    }

    if (hasOrder) {
        // Soft-disable: keep the row, mark out of stock. The storefront filter
        // already hides in_stock=false items from the customer catalog.
        const r = await sbFetch(`products?id=eq.${encodeURIComponent(body.id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ in_stock: false, instock: false, updated_at: new Date().toISOString() }),
        });
        if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
        return res.status(200).json({ ok: true, soft_deleted: true, product: (r.data || [])[0] });
    }

    // No historical orders → safe to hard delete.
    const r = await sbFetch(`products?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
    });
    if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
    return res.status(200).json({ ok: true, hard_deleted: true, product: (r.data || [])[0] });
}
