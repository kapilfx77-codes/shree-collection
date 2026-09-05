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
            `orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,payment_method,payment_status`
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

        const nowIso = new Date().toISOString();
        const adminSub = String((session && session.sub) || 'admin');

        const updates = {
            payment_status: 'failed',
            payment_rejected_at: nowIso,
            payment_rejected_by: adminSub,
            payment_rejection_reason: reason,
        };

        // Race-safe update: only matches rows still in the expected state.
        const r = await sbFetch(
            `orders?order_id=eq.${encodeURIComponent(orderId)}` +
            `&payment_method=eq.esewa&payment_status=eq.pending`,
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
        return res.status(200).json({ ok: true, order: rows[0] });
    } catch (err) {
        console.error('admin/orders/reject error:', err);
        return res.status(500).json({
            error: 'Server error',
            detail: String((err && err.message) || err),
        });
    }
}
