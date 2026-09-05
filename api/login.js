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
// (see sql/002_admin_settings.sql). On a successful match against that
// hash, we issue a token signed with the session_secret from the same row.
//
// FALLBACK
// --------
// If the admin_settings table cannot be read (e.g. the migration hasn't
// been run on a fresh deploy), we fall back to a plain compare against
// process.env.ADMIN_PASSWORD. This is a one-time bootstrap path so the
// dashboard still works immediately after deploy. After the migration
// runs (and ideally after the admin changes their password from the
// Settings page), the table is the source of truth.
// ==========================================================================

import bcrypt from 'bcryptjs';
import { issueAdminToken, loadAdminSettings } from '../lib/admin-auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body || {};
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ error: 'Password is required' });
        }

        // 1. Try the table-backed path.
        const settings = await loadAdminSettings();
        if (settings.passwordHash) {
            const ok = await bcrypt.compare(password, settings.passwordHash);
            if (ok) {
                return res.status(200).json({
                    success: true,
                    message: 'Authenticated successfully',
                    token: await issueAdminToken(),
                });
            }
            // Hash exists but didn't match — don't fall through to the env
            // fallback (that would let an admin with the env-var password
            // log in even after the table hash has been changed). Hard fail.
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }

        // 2. Bootstrap path: the table is missing/unreachable. Use the
        //    env-var password. This branch only runs when loadAdminSettings
        //    could not read a password_hash from the database.
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
