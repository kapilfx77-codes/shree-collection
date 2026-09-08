// ==========================================================================
// POST /api/admin/orders/reject
// ==========================================================================
// Dedicated Vercel serverless function for the admin "Reject Payment" action
// on a pending eSewa order. Mirrors the verify.js structure — see that
// file's header for the Vercel routing rationale.
//
// Auth: requires a valid admin session bearer token (admin-auth.js).
//
// Rejection requires a reason of at least 4 characters so the audit trail
// always explains why. Resulting state is payment_status='failed' with
// payment_rejected_at / payment_rejected_by / payment_rejection_reason
// populated.
//
// Atomicity: same race-safety pattern as verify.js — pre-check + state
// filter in the PATCH. Two concurrent rejects cannot both succeed.
//
// Inventory restore: when the PATCH succeeds, every line in the order is
// restored to its variant's inventory row via the `restore_inventory` RPC.
// Because the PATCH is filtered by `payment_rejected_at IS NULL` it can
// only succeed once, so the restore can only run once. A second reject
// returns 409 before the restore path is reached.
// ==========================================================================

import {
    requireAdmin,
    requireServiceKey,
    sbFetch,
} from '../../../lib/admin-auth.js';

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        const orderId = String(body.order_id || '').trim();
        const reason = String(body.reason || '').trim();
        if (!orderId) {
            return res.status(400).json({ error: 'order_id is required' });
        }
        if (reason.length < 4) {
            return res.status(400).json({
                error: 'A rejection reason of at least 4 characters is required.',
            });
        }

        const lookup = await sbFetch(
            `orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,payment_method,payment_status,items`
        );
        if (lookup.status >= 400) {
            return res.status(lookup.status).json(lookup.data || { error: lookup.raw });
        }
        if (!Array.isArray(lookup.data) || lookup.data.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const order = lookup.data[0];
        if (order.payment_method !== 'esewa') {
            return res.status(409).json({ error: 'Only eSewa orders can be rejected by this action.' });
        }
        if (order.payment_status === 'paid') {
            return res.status(409).json({
                error: 'This order is already marked as paid and cannot be rejected.',
            });
        }
        if (order.payment_status !== 'pending') {
            return res.status(409).json({
                error: `This order cannot be rejected from state "${order.payment_status}".`,
            });
        }
        if (order.payment_rejected_at) {
            return res.status(409).json({
                error: 'This order has already been rejected; inventory was already restored once.',
            });
        }

        const nowIso = new Date().toISOString();
        const adminSub = String((session && session.sub) || 'admin');

        const updates = {
            payment_status: 'failed',
            payment_rejected_at: nowIso,
            payment_rejected_by: adminSub,
            payment_rejection_reason: reason,
        };

        // Race-safe update: only matches rows still in the expected
        // state. The `payment_rejected_at=is.null` filter is the second
        // line of defence — even if another admin has flipped
        // payment_status by hand, the rejection audit columns can only
        // be written once.
        const r = await sbFetch(
            `orders?order_id=eq.${encodeURIComponent(orderId)}` +
            `&payment_method=eq.esewa&payment_status=eq.pending` +
            `&payment_rejected_at=is.null`,
            {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify(updates),
            }
        );
        if (r.status >= 400) {
            return res.status(r.status).json(r.data || { error: r.raw });
        }
        const rows = Array.isArray(r.data) ? r.data : [];
        if (rows.length === 0) {
            return res.status(409).json({ error: 'Order state changed before rejection could complete.' });
        }
        const updated = rows[0];

        // Restore inventory atomically per line. The PATCH above was
        // idempotent — only one reject can succeed — so this block can
        // only run once per order. We restore best-effort: if the RPC
        // errors on a particular variant (e.g. legacy row without
        // color/size), we log it and continue. The order is already
        // marked failed; the admin can re-adjust stock via the
        // inventory screen if needed.
        const items = Array.isArray(updated.items) ? updated.items : (Array.isArray(order.items) ? order.items : []);
        const restoreReport = { attempted: 0, restored: 0, errors: [] };
        for (const line of items) {
            const pid = Number(line && line.id);
            const color = String((line && line.color) || '').trim();
            const size = String((line && line.size) || '').trim();
            const qty = Math.floor(Number(line && line.quantity));
            if (!Number.isInteger(pid) || pid <= 0 || !color || !size || !Number.isInteger(qty) || qty <= 0) {
                continue;
            }
            restoreReport.attempted += 1;
            // eslint-disable-next-line no-await-in-loop
            const rInv = await sbFetch('rpc/restore_inventory', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                    p_product_id: pid,
                    p_color: color,
                    p_size: size,
                    p_qty: qty,
                }),
            });
            if (rInv.status >= 400) {
                console.error('restore_inventory error:', rInv.status, rInv.data || rInv.raw);
                restoreReport.errors.push({ pid, color, size, qty, status: rInv.status, detail: rInv.data || rInv.raw });
            } else {
                restoreReport.restored += 1;
            }
        }

        return res.status(200).json({ ok: true, order: updated, inventory_restore: restoreReport });
    } catch (err) {
        console.error('admin/orders/reject error:', err);
        return res.status(500).json({
            error: 'Server error',
            detail: String((err && err.message) || err),
        });
    }
}
