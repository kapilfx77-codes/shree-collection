// ==========================================================================
// VERCEL SERVERLESS FUNCTION - ADMIN AUTHENTICATION
// ==========================================================================
// Deploy this to Vercel. Set ADMIN_PASSWORD in your Vercel project's
// Environment Variables settings.
//
// Endpoint: POST /api/login
// Body: { "password": "..." }

export default async function handler(req, res) {
    // Only accept POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body || {};

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        // Get admin password from Vercel environment variables, fallback for local dev
        const correctPassword = process.env.ADMIN_PASSWORD || 'shree2026';

        if (password === correctPassword) {
            // Success - return a simple token/session payload
            return res.status(200).json({
                success: true,
                message: 'Authenticated successfully',
                token: Buffer.from(`shree_admin_${Date.now()}`).toString('base64')
            });
        } else {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Server error' });
    }
}
