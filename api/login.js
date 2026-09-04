// ==========================================================================
// VERCEL SERVERLESS FUNCTION - ADMIN LOGIN
// ==========================================================================
// POST { password: "..." } → 200 { success, token } | 401 { error }
//
// The token is a stateless HMAC-signed session that /api/admin/* can verify
// without a shared database. Set ADMIN_PASSWORD (and optionally
// ADMIN_SESSION_SECRET) in your Vercel project's Environment Variables.
// ==========================================================================

import { issueAdminToken } from '../lib/admin-auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body || {};

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        const correctPassword = process.env.ADMIN_PASSWORD || 'shree2026';

        if (password === correctPassword) {
            return res.status(200).json({
                success: true,
                message: 'Authenticated successfully',
                token: issueAdminToken()
            });
        }

        return res.status(401).json({ success: false, error: 'Invalid password' });
    } catch (err) {
        return res.status(500).json({ error: 'Server error' });
    }
}
