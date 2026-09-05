// ==========================================================================
// POST /api/admin/orders/verify
// ==========================================================================
// Dedicated Vercel serverless function for the admin "Verify Payment" action
// on a pending eSewa order. Lives at its own file path because Vercel routes
// /api/admin/orders/verify to api/admin/orders/verify.js — the previous
// url.endsWith('/verify') dispatch inside api/admin/orders.js was never
// reached in production.
//
// Auth: requires a valid admin session bearer token (admin-auth.js). The
// verified-by value comes from the token's `sub` claim — the browser
// never supplies the admin id.
//
// Atomicity: the order must be in state (payment_method='esewa' AND
// payment_status='pending') at the moment of the update. We re-read the
// order just before writing, AND we constrain the PATCH to rows still in
// that state. If two admins click Verify simultaneously, exactly one
// PATCH matches a row and the other gets 0 rows back → 409.
//
// Response: 200 { ok, order } on success.
//           400 missing/invalid order_id
//           401 missing or invalid admin token
//           404 order not found
//           409 wrong method, wrong state, or already paid
//           503 service key not configured
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
        if (!orderId) {
            return res.status(400).json({ error: 'order_id is required' });
        }

        // Load the order so we can (a) confirm it exists, (b) confirm it is
        // an eSewa order, and (c) confirm it is not already paid. This is a
        // pre-check; the PATCH filter below is the real race-safety net.
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
            return res.status(409).json({ error: 'Only eSewa orders can be verified by this action.' });
        }
        if (order.payment_status === 'paid') {
            return res.status(409).json({ error: 'This order is already marked as paid.' });
        }
        if (order.payment_status !== 'pending') {
            return res.status(409).json({
                error: `This order cannot be verified from state "${order.payment_status}".`,
            });
        }

        // Server-authoritative timestamp. The browser cannot influence this.
        const nowIso = new Date().toISOString();
        // Server-authoritative admin identity. The token's sub claim is
        // verified by requireAdmin; we trust that, not body.admin_id.
        const adminSub = String((session && session.sub) || 'admin');
        // Verification source is intentionally hard-coded. A future
        // automated gateway could pass a different source here, but for now
        // every verification is a manual admin action.
        const source = 'manual_admin';

        const updates = {
            payment_status: 'paid',
            payment_verified_at: nowIso,
            payment_verified_by: adminSub,
            payment_verification_source: source,
        };

        // Race-safe update: only matches rows still in the expected state.
        // If a concurrent verify flipped the row to 'paid' between the
        // pre-check and this PATCH, this filter returns 0 rows and we
        // return 409.
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
            // The pre-check passed but the PATCH matched nothing — another
            // admin won the race.
            return res.status(409).json({ error: 'Order state changed before verification could complete.' });
        }
        return res.status(200).json({ ok: true, order: rows[0] });
    } catch (err) {
        console.error('admin/orders/verify error:', err);
        return res.status(500).json({
            error: 'Server error',
            detail: String((err && err.message) || err),
        });
    }
}
