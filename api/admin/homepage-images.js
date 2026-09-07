// ============================================================================
// VERCEL SERVERLESS FUNCTION — Homepage Images (admin writes only)
// ============================================================================
// POST { slot, image_url } → writes to public.homepage_images via service role
// Requires admin bearer token (same auth as /api/admin/upload-image)
// ============================================================================

import { requireAdmin, requireServiceKey, SUPABASE_SERVICE_KEY, SUPABASE_URL, sbFetch } from '../../lib/admin-auth.js';

export default async function handler(req, res) {
    // Only POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Service key check
    const missing = requireServiceKey(res);
    if (missing) return;

    // Admin token check
    const payload = await requireAdmin(req, res);
    if (!payload) return; // requireAdmin sends 401 response

    try {
        const { slot, image_url } = req.body || {};
        if (!slot || typeof slot !== 'string') {
            return res.status(400).json({ error: 'slot is required' });
        }
        if (!image_url || typeof image_url !== 'string') {
            return res.status(400).json({ error: 'image_url is required' });
        }

        const url = `${SUPABASE_URL}/rest/v1/homepage_images`;
        const headers = {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates',
        };
        // Upsert: PATCH with id=slot (primary key is text, not number)
        // PostgREST expects POST for insert; use PATCH with Prefer header
        const body = JSON.stringify({
            slot,
            image_url,
            updated_at: new Date().toISOString(),
        });

        // Try PATCH first (update existing row by slot primary key via ?slot=eq... filter)
        // PostgREST uses filter params rather than primary key in URL for text PKs.
        const patchResp = await fetch(`${url}?slot=eq.${encodeURIComponent(slot)}`, {
            method: 'PATCH',
            headers,
            body,
        });
        const text = await patchResp.text();
        if (!patchResp.ok) {
            // If PATCH fails (e.g., no row yet), fall back to POST (insert)
            const postResp = await fetch(url, {
                method: 'POST',
                headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
                body,
            });
            const postText = await postResp.text();
            if (!postResp.ok) {
                return res.status(postResp.status || 500).json({
                    error: 'Failed to save homepage image',
                    detail: postText,
                });
            }
            return res.status(200).json({ ok: true, inserted: true, slot, image_url });
        }
        return res.status(200).json({ ok: true, updated: true, slot, image_url });
    } catch (err) {
        console.error('homepage-images error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
