// ==========================================================================
// /api/admin/upload-image — service-role Supabase Storage upload
// ==========================================================================
// Browser sends { filename, contentType, base64 }. Server decodes, uploads
// to the product-images bucket via the service role key, returns the
// public URL. Doing this server-side keeps the service key out of the
// browser and lets the server return real error messages.
// ==========================================================================

import { requireAdmin, sbFetch, requireServiceKey, SUPABASE_URL, SUPABASE_SERVICE_KEY } from '../../lib/admin-auth.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = requireAdmin(req, res);
    if (!session) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        const { filename = 'upload.jpg', contentType = 'image/jpeg', base64 } = body;
        if (!base64) return res.status(400).json({ error: 'base64 is required' });

        if (!ALLOWED_TYPES.has(contentType)) {
            return res.status(400).json({ error: `Unsupported content type: ${contentType}` });
        }

        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > MAX_BYTES) {
            return res.status(413).json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` });
        }

        // Sanitize filename, build unique storage path
        const extMatch = /\.([a-zA-Z0-9]+)$/.exec(filename);
        const ext = (extMatch ? extMatch[1] : 'jpg').toLowerCase();
        const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext) ? ext : 'jpg';
        const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        const objectName = `admin/${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${safeBase}.${safeExt}`;

        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/product-images/${objectName}`;
        const upResp = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': contentType,
                'x-upsert': 'false',
            },
            body: buffer,
        });
        const upText = await upResp.text();
        if (!upResp.ok) {
            return res.status(upResp.status).json({ error: 'Upload failed', detail: upText.slice(0, 500) });
        }

        return res.status(200).json({
            ok: true,
            url: `${SUPABASE_URL}/storage/v1/object/public/product-images/${objectName}`,
            path: objectName,
            size: buffer.length,
        });
    } catch (err) {
        console.error('admin/upload-image error:', err);
        return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
    }
}
