// ==========================================================================
// /api/admin/batches — list FIFO cost batches per variant
// ==========================================================================
// GET ?product_id=...&color=...&size=... → batch rows for that variant
// GET ?product_id=...                    → all batches for that product
// GET (no params)                        → all batches (limit 200, ordered newest-first)
//
// service_role key only — RLS blocks anon/authenticated.
// ==========================================================================

import { requireAdmin, sbFetch, requireServiceKey } from '../../lib/admin-auth.js';

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    try {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleGet(req, res);
    } catch (err) {
        console.error('admin/batches error:', err);
        return res.status(500).json({ error: 'Server error', detail: String((err && err.message) || err) });
    }
}

async function handleGet(req, res) {
    const { product_id: productId, color, size } = req.query || {};

    if (!productId) {
        // Return all batches, newest first, capped at 200 rows.
        const r = await sbFetch(
            'inventory_cost_batches?select=*&order=created_at.desc&limit=200'
        );
        if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });
        return res.status(200).json({ batches: r.data || [] });
    }

    const pid = encodeURIComponent(String(productId));
    const filters = [`product_id=eq.${pid}`];
    if (color) filters.push(`color=eq.${encodeURIComponent(String(color))}`);
    if (size)  filters.push(`size=eq.${encodeURIComponent(String(size))}`);
    filters.push('order=created_at.asc'); // FIFO: oldest first

    const query = `inventory_cost_batches?select=*&${filters.join('&')}`;
    const r = await sbFetch(query);
    if (r.status >= 400) return res.status(r.status).json(r.data || { error: r.raw });

    // Also return the current variant-level inventory for reference.
    const invFilters = [`product_id=eq.${pid}`];
    if (color) invFilters.push(`color=eq.${encodeURIComponent(String(color))}`);
    if (size)  invFilters.push(`size=eq.${encodeURIComponent(String(size))}`);
    const invR = await sbFetch(`inventory?select=quantity,reserved,available&${invFilters.join('&')}`);
    const inventory = (invR.status === 200 && Array.isArray(invR.data)) ? invR.data : [];

    return res.status(200).json({
        batches: r.data || [],
        inventory,
    });
}
