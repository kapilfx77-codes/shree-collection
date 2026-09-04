// ==========================================================================
// Admin serverless helpers — shared by every /api/admin/* route
// ==========================================================================
// All admin writes go through serverless functions. They use the Supabase
// service role key (which bypasses RLS) and require a valid admin session
// token obtained from /api/login. The browser never gets the service role key.
//
// Every endpoint must:
//   1. Check the Authorization header has a Bearer token
//   2. Validate the token (shared secret + timestamp + HMAC)
//   3. Reject any request without a valid token
//
// This file lives in /lib (NOT in /api) so Vercel does not try to deploy it
// as a serverless function — it has no default export and would fail to build.
// ==========================================================================

import crypto from 'node:crypto';

const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  process.env.ADMIN_PASSWORD ||
  'shree2026';

export const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://scngozslllefwivasslu.supabase.co';

// STRICT: only the service role key counts. We deliberately do NOT fall back
// to SUPABASE_ANON_KEY — if the env var is missing, every admin call must
// fail loudly (503) instead of silently running with no RLS bypass, which
// would be indistinguishable from a leaked anon key.
export const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';

export const ALLOWED_ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
export const ALLOWED_PAYMENT_METHODS = ['cod', 'esewa'];
export const ALLOWED_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

// Returns true iff the service role key is configured. Endpoints should call
// this and return 503 if false.
export function hasServiceKey() {
  return Boolean(SUPABASE_SERVICE_KEY);
}

// --- Token format: base64(payload).hex(hmac) ---------------------------
// payload = { sub: 'admin', iat: <ms>, exp: <ms> }
// The /api/login route issues these. They're stateless; we re-verify HMAC +
// expiry on every request. 8-hour lifetime.

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

export function issueAdminToken(ttlMs = 8 * 60 * 60 * 1000) {
  const now = Date.now();
  const payload = { sub: 'admin', iat: now, exp: now + ttlMs };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(body)
    .digest('hex');
  return `${body}.${sig}`;
}

export function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing-token' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(body)
    .digest('hex');
  // constant-time compare
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return { ok: false, reason: 'bad-signature' };
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf-8'));
  } catch {
    return { ok: false, reason: 'malformed-payload' };
  }
  if (payload.sub !== 'admin') return { ok: false, reason: 'wrong-subject' };
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

export function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    res.status(401).json({ error: 'Missing bearer token' });
    return null;
  }
  const result = verifyAdminToken(match[1]);
  if (!result.ok) {
    res.status(401).json({ error: 'Invalid or expired session', reason: result.reason });
    return null;
  }
  return result.payload;
}

// Returns 503 response object if the service key is missing; null otherwise.
// Callers should `if (m) return m;` to short-circuit.
export function requireServiceKey(res) {
  if (!hasServiceKey()) {
    res.status(503).json({
      error: 'Admin API not configured: SUPABASE_SERVICE_ROLE_KEY is missing on the server. Set it in Vercel → Project → Settings → Environment Variables.'
    });
    return true;
  }
  return false;
}

// Minimal Supabase REST helper. The service role key bypasses RLS so we get
// full read+write on any table the API needs to manage.
export async function sbFetch(path, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { /* not json, leave null */ }
  }
  return { status: resp.status, ok: resp.ok, data: json, raw: text };
}
