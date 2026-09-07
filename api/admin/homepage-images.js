// ============================================================================
// VERCEL SERVERLESS FUNCTION — Homepage Images (admin writes only)
// ============================================================================
// POST { slot, image_url } → writes to public.homepage_images via service role
// Requires admin bearer token (same auth as /api/admin/upload-image)
// ============================================================================

import { requireAdmin, requireServiceKey, SUPABASE_SERVICE_KEY, SUPABASE_URL } from '../../lib/admin-auth.js';

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

        // Single atomic upsert via POST with Prefer: resolution=merge-duplicates.
        // PostgREST requires POST (not PATCH) to use the merge-duplicates
        // upsert resolution; the on_conflict target defaults to the primary
        // key (slot). This replaces the prior PATCH-then-POST dance, which
        // could leave the table with a stale row if the PATCH silently
        // updated nothing and the POST then hit a unique-violation that
        // surfaced as "Failed to save homepage image".
        const url = `${SUPABASE_URL}/rest/v1/homepage_images?on_conflict=slot`;
        const headers = {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=representation',
        };
        const body = JSON.stringify([{
            slot,
            image_url,
            updated_at: new Date().toISOString(),
        }]);

        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body,
        });
        const text = await resp.text();
        if (!resp.ok) {
            return res.status(resp.status || 500).json({
                error: 'Failed to save homepage image',
                detail: text,
            });
        }
        return res.status(200).json({ ok: true, slot, image_url });
    } catch (err) {
        console.error('homepage-images error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
