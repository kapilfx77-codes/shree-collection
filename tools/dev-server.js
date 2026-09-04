/**
 * Local dev server — handles both static files AND /api/* routes.
 * Acts as a stand-in for `vercel dev` so the Playwright smoke tests
 * can exercise the admin login flow without a Vercel account.
 *
 * Usage:
 *   node tools/dev-server.js
 *   node tools/dev-server.js --port 9090
 *
 * Routes handled:
 *   POST /api/login          → issues HMAC session token (same algorithm as lib/admin-auth.js)
 *   GET  /api/admin/products → returns [] (read-only smoke test)
 *   GET  /api/admin/orders  → returns { orders: [] }
 *   GET  /api/admin/upload-image → returns { url: '' }
 *   *                         → serves static file from PROJECT_ROOT
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '9090', 10);

// Reuse the production helpers from lib/admin-auth.js so the dev server
// stays in lock-step with Vercel. The strict service-key requirement
// (no anon-key fallback) is enforced here too.
const {
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    hasServiceKey,
    issueAdminToken,
    verifyAdminToken,
} = await import('../lib/admin-auth.js');

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff2':'font/woff2',
    '.woff': 'font/woff',
    '.ttf':  'font/ttf',
};

function serveStatic(req, res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
            return;
        }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
async function handleApiLogin(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        let password = '';
        try { ({ password } = JSON.parse(body)); } catch {}
        if (!password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Password is required' }));
            return;
        }
        const correct = process.env.ADMIN_PASSWORD || 'shree2026';
        if (password === correct) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Authenticated', token: issueAdminToken() }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid password' }));
        }
    });
}

async function handleApiAdminProducts(req, res) {
    // If service key is NOT configured, return 503 — matching production.
    // (The empty-list behavior used to mask misconfiguration, which is exactly
    // the foot-gun the production hardening is trying to fix.)
    if (!hasServiceKey()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set. Configure it in your environment to use the admin API.' }));
        return;
    }
    // Smoke-test mode: if the key is the sentinel dummy, return empty arrays
    // so the UI renders correctly without needing a real Supabase connection.
    if (SUPABASE_SERVICE_KEY === 'dev-dummy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const qs = url.searchParams.toString();
    const fetchUrl = `${SUPABASE_URL}/rest/v1/products?select=*&order=id.asc${qs ? '&' + qs : ''}`;
    try {
        const r = await fetch(fetchUrl, {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        });
        const data = await r.json();
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream error', detail: String(e) }));
    }
}

async function handleApiAdminOrders(req, res) {
    if (!hasServiceKey()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set. Configure it in your environment to use the admin API.' }));
        return;
    }
    if (SUPABASE_SERVICE_KEY === 'dev-dummy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ orders: [], total: 0 }));
        return;
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const qs = url.searchParams.toString();
    const fetchUrl = `${SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc${qs ? '&' + qs : ''}`;
    try {
        const r = await fetch(fetchUrl, {
            headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        });
        const data = await r.json();
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ orders: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 }));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream error', detail: String(e) }));
    }
}

async function handleApiAdminUploadImage(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: '', error: 'Upload not available in local dev' }));
}

async function handleApiAdmin(req, res) {
    // Route: /api/admin/products, /api/admin/orders, /api/admin/upload-image
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname.replace('/api/admin/', '');
    // Verify token using the SAME helper as production.
    const auth = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (!match) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing bearer token' }));
        return;
    }
    const v = verifyAdminToken(match[1]);
    if (!v.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired session', reason: v.reason }));
        return;
    }
    // Route to handler
    if (pathname === 'products') {
        await handleApiAdminProducts(req, res);
    } else if (pathname === 'orders') {
        await handleApiAdminOrders(req, res);
    } else if (pathname === 'upload-image') {
        await handleApiAdminUploadImage(req, res);
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
}

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------
http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

    if (pathname === '/api/login') {
        return handleApiLogin(req, res);
    }
    if (pathname.startsWith('/api/admin/')) {
        return handleApiAdmin(req, res);
    }

    // Static serving
    let filePath = path.join(PROJECT_ROOT, pathname === '/' ? '/index.html' : pathname);
    // Security: prevent directory traversal
    if (!filePath.startsWith(PROJECT_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    serveStatic(req, res, filePath);
}).listen(PORT, () => {
    console.log(`Dev server running at http://127.0.0.1:${PORT}`);
    console.log(`Serving: ${PROJECT_ROOT}`);
    console.log(`Press Ctrl+C to stop`);
});
