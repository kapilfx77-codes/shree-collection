// ==========================================================================
// /api/admin/orders — list + status update + payment update
// ==========================================================================
// GET    ?order_id=...           → one order or 404
// GET    (no params, paginated)  → { orders, total, page, pageSize }
// PATCH  body: { order_id, status?, payment_status?, payment_method? }
// DELETE body: { order_id }      → only cancels (status='cancelled'),
//                                  does not physically delete (preserves history)
// ==========================================================================

import { requireAdmin, sbFetch, requireServiceKey, ALLOWED_ORDER_STATUSES, ALLOWED_PAYMENT_METHODS, ALLOWED_PAYMENT_STATUSES } from '../../lib/admin-auth.js';

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    try {
        if (req.method === 'GET') {
            return await handleGet(req, res);
        }
        if (req.method === 'PATCH') {
            return await handlePatch(req, res);
        }
        if (req.method === 'DELETE') {
            return await handleCancel(req, res);
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin/orders error:', err);
        return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
    }
}

async function handleGet(req, res) {
    const { order_id, status, payment_status, payment_method, search, page = '1', pageSize = '50' } = req.query || {};

    if (order_id) {
        const r = await sbFetch(`orders?order_id=eq.${encodeURIComponent(order_id)}&select=*`);
        if (r.status !== 200) return res.status(r.status).json(r.data || { error: r.raw });
        if (!r.data || r.data.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(r.data[0]);
    }

    const filters = [];
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    if (payment_status) filters.push(`payment_status=eq.${encodeURIComponent(payment_status)}`);
    if (payment_method) filters.push(`payment_method=eq.${encodeURIComponent(payment_method)}`);
    if (search) {
        const esc = String(search).replace(/[%_]/g, '\\$&');
        // Search by order_id, name, phone, or city
        filters.push(`or=(order_id.ilike.*${esc}*,name.ilike.*${esc}*,phone.ilike.*${esc}*,city.ilike.*${esc}*)`);
    }
    filters.push('order=created_at.desc');

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const sizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
    const offset = (pageNum - 1) * sizeNum;
    filters.push(`limit=${sizeNum}`);
    filters.push(`offset=${offset}`);

    const listQuery = `orders?select=*&${filters.join('&')}`;
    const r = await sbFetch(listQuery);
    if (r.status !== 200) return res.status(r.status).json(r.data || { error: r.raw });

    // Count for pagination
    const countQuery = `orders?select=id${filters.filter(f => !f.startsWith('limit=') && !f.startsWith('offset=') && !f.startsWith('order=')).join('&')}`;
    const c = await sbFetch(countQuery, { headers: { Prefer: 'count=exact' } });
    // Supabase returns the count in Content-Range header; with REST we need to read it
    // Instead, fetch lightweight count query and trust the body length
    const total = c.data ? c.data.length : 0;

    return res.status(200).json({
        orders: r.data || [],
        page: pageNum,
        pageSize: sizeNum,
        returned: (r.data || []).length
    });
}

async function handlePatch(req, res) {
    const body = req.body || {};
    if (!body.order_id) return res.status(400).json({ error: 'order_id is required' });

    const updates = {};
    if (body.status !== undefined) {
        if (!ALLOWED_ORDER_STATUSES.includes(body.status)) {
            return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_ORDER_STATUSES.join(', ')}` });
        }
        updates.status = body.status;
    }
    if (body.payment_status !== undefined) {
        if (!ALLOWED_PAYMENT_STATUSES.includes(body.payment_status)) {
            return res.status(400).json({ error: `Invalid payment_status. Allowed: ${ALLOWED_PAYMENT_STATUSES.join(', ')}` });
        }
        updates.payment_status = body.payment_status;
    }
    if (body.payment_method !== undefined) {
        if (!ALLOWED_PAYMENT_METHODS.includes(body.payment_method)) {
            return res.status(400).json({ error: `Invalid payment_method. Allowed: ${ALLOWED_PAYMENT_METHODS.join(', ')}` });
        }
        updates.payment_method = body.payment_method;
    }
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    const r = await sbFetch(
        `orders?order_id=eq.${encodeURIComponent(body.order_id)}`,
        {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(updates),
        }
    );
    if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
    return res.status(200).json({ ok: true, order: (r.data || [])[0] });
}

async function handleCancel(req, res) {
    const body = req.body || {};
    if (!body.order_id) return res.status(400).json({ error: 'order_id is required' });

    // Soft cancel: never DELETE. Preserve order history.
    const r = await sbFetch(
        `orders?order_id=eq.${encodeURIComponent(body.order_id)}`,
        {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ status: 'cancelled' }),
        }
    );
    if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
    return res.status(200).json({ ok: true, order: (r.data || [])[0], soft_deleted: true });
}
