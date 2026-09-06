// ==========================================================================
// /api/admin/inventory/cost — add stock with a known unit cost
// ==========================================================================
// POST body: { product_id, color, size, quantity, unit_cost }
// Creates a new FIFO batch via add_inventory_batch RPC.
// Does NOT touch existing batches — each add creates a new batch.
// ==========================================================================

import { requireAdmin, sbFetch, requireServiceKey } from '../../../lib/admin-auth.js';

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        const productId = Number(body.product_id);
        const color = String(body.color || '').trim();
        const size = String(body.size || '').trim();
        const quantity = Math.floor(Number(body.quantity));
        const unitCost = parseFloat(body.unit_cost);

        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ error: 'product_id is required and must be a positive integer' });
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'quantity must be a positive integer' });
        }
        if (isNaN(unitCost) || unitCost < 0) {
            return res.status(400).json({ error: 'unit_cost must be a non-negative number' });
        }

        const r = await sbFetch('rpc/add_inventory_batch', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                p_product_id: productId,
                p_color: color,
                p_size: size,
                p_qty: quantity,
                p_unit_cost: unitCost,
            }),
        });
        if (r.status >= 400) {
            return res.status(r.status).json(r.data || { error: r.raw });
        }
        const rows = Array.isArray(r.data) ? r.data : [];
        return res.status(200).json({
            ok: true,
            batch_id: rows[0]?.batch_id ?? null,
            total_available: rows[0]?.total_available ?? null,
            by: (session && session.sub) || 'admin',
        });
    } catch (err) {
        console.error('admin/inventory/cost error:', err);
        return res.status(500).json({ error: 'Server error', detail: String((err && err.message) || err) });
    }
}
