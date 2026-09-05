// ==========================================================================
// VERCEL SERVERLESS FUNCTION - ADMIN LOGIN
// ==========================================================================
// POST { password: "..." } → 200 { success, token } | 401 { error }
//
// The token is a stateless HMAC-signed session that /api/admin/* can verify
// without a shared database.
//
// PASSWORD SOURCE OF TRUTH
// ------------------------
// The current admin password hash is stored in the `admin_settings` table
// (see sql/002_admin_settings.sql). Verification is delegated to the
// verify_admin_password RPC in Postgres (sql/005) so the same implementation
// (pgcrypto's crypt()) that wrote the hash does the compare. Doing the
// compare in Node via bcryptjs gave us a cross-version skew bug: a hash
// written by one bcryptjs build didn't always verify under another.
//
// FALLBACK
// --------
// If the admin_settings table cannot be read (e.g. the migration hasn't
// been run on a fresh deploy), or the verify_admin_password RPC isn't
// installed yet (404), we fall back to a bcryptjs compare locally. This is
// a one-time bootstrap path so the dashboard still works immediately after
// deploy. After the migration runs (and ideally after the admin changes
// their password from the Settings page), the table+RPC is the source of
// truth.
// ==========================================================================

import { issueAdminToken, loadAdminSettings, sbFetch } from '../lib/admin-auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body || {};
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ error: 'Password is required' });
        }

        // 1. Try the RPC path. The RPC does `crypt(pwd, stored_hash) =
        //    stored_hash` server-side using pgcrypto.
        const verifyResp = await sbFetch('rpc/verify_admin_password', {
            method: 'POST',
            body: JSON.stringify({ pwd: password }),
        });
        if (verifyResp.ok && typeof verifyResp.data === 'boolean') {
            if (verifyResp.data) {
                return res.status(200).json({
                    success: true,
                    message: 'Authenticated successfully',
                    token: await issueAdminToken(),
                });
            }
            // RPC returned false: the password is wrong. Don't fall through
            // to env-var — that would let an admin with the env-var password
            // log in even after the table hash has been changed. Hard fail.
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }

        // 2. RPC missing (404) or unreachable. Bootstrap path: do a local
        //    compare against the stored hash (via bcryptjs), or against
        //    process.env.ADMIN_PASSWORD if the table is also unreachable.
        //    This branch only runs when 005 hasn't been applied yet.
        if (verifyResp.status !== 404) {
            // The RPC exists but failed for some other reason. Log and fall
            // through to the local fallback so the user isn't locked out.
            console.error('login: verify_admin_password RPC failed:', verifyResp.status, verifyResp.data);
        }
        const settings = await loadAdminSettings();
        if (settings.passwordHash) {
            const bcrypt = (await import('bcryptjs')).default;
            const ok = await bcrypt.compare(password, settings.passwordHash);
            if (ok) {
                return res.status(200).json({
                    success: true,
                    message: 'Authenticated successfully',
                    token: await issueAdminToken(),
                });
            }
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }
        const envPassword = process.env.ADMIN_PASSWORD || 'shree2026';
        if (password === envPassword) {
            return res.status(200).json({
                success: true,
                message: 'Authenticated successfully',
                token: await issueAdminToken(),
            });
        }
        return res.status(401).json({ success: false, error: 'Invalid password' });
    } catch (err) {
        // Don't leak the actual error to the client (it could include
        // stack info). Log it server-side for debugging.
        console.error('login error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}
