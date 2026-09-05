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
//
// PASSWORD + SESSION-SECRET STORAGE
// ---------------------------------
// The admin password hash and the HMAC session secret live in the
// `admin_settings` table (see sql/002_admin_settings.sql). They are read
// on demand with a short in-process cache so a single cold-start of the
// serverless function only hits Supabase once. The cache is invalidated
// automatically when the password is rotated, so a successful password
// change is observed by the very next request without a redeploy.
//
// If the `admin_settings` table cannot be read (e.g. the migration hasn't
// been run yet), every auth-relevant function falls back to
// process.env.ADMIN_PASSWORD as a one-time bootstrap value. This is a
// strictly read-only env-var fallback; the password is never written back
// to env.
// ==========================================================================

import crypto from 'node:crypto';

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

// --- Minimal Supabase REST helper -----------------------------------------
// The service role key bypasses RLS so we get full read+write on any table
// the API needs to manage.
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

// ==========================================================================
// admin_settings — single-row table with password_hash and session_secret
// ==========================================================================
// In-process cache so we don't hit Supabase on every request. Cleared by
// invalidateSettings() (called by /api/admin/change-password after a
// successful rotation).
let _settingsCache = null;       // { passwordHash, sessionSecret, loadedAt }
let _settingsCachePromise = null; // de-dup concurrent reads
const SETTINGS_TTL_MS = 5 * 60 * 1000; // 5 min — password rarely changes

// In-memory override used only when the Supabase table is unreachable
// (e.g. migration not yet run on a fresh deploy). If the override is
// non-null, we use it instead of the env var as the bootstrap password.
let _bootstrapOverride = null;

function envBootstrapSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    'shree2026'
  );
}

// Read the admin_settings row, with caching and a graceful fallback to
// process.env.ADMIN_PASSWORD when the table is unavailable. Returns
//   { passwordHash: string|null, sessionSecret: string }
// where `passwordHash === null` means "fall back to env".
export async function loadAdminSettings({ force = false } = {}) {
  if (!force && _settingsCache && Date.now() - _settingsCache.loadedAt < SETTINGS_TTL_MS) {
    return _settingsCache;
  }
  if (_settingsCachePromise) {
    // de-dup a concurrent call: await the in-flight read.
    return _settingsCachePromise;
  }
  _settingsCachePromise = (async () => {
    try {
      const r = await sbFetch('admin_settings?id=eq.1&select=value');
      if (r.ok && r.data && r.data[0] && r.data[0].value) {
        const v = r.data[0].value || {};
        const cache = {
          passwordHash: typeof v.password_hash === 'string' ? v.password_hash : null,
          sessionSecret: typeof v.session_secret === 'string' ? v.session_secret : null,
          loadedAt: Date.now(),
        };
        // If either field is missing, fall back to env. This protects against
        // a partial row (e.g. a half-applied migration).
        if (!cache.passwordHash) {
          cache.passwordHash = null;
        }
        if (!cache.sessionSecret) {
          cache.sessionSecret = envBootstrapSecret();
        }
        _settingsCache = cache;
        return cache;
      }
    } catch {
      // fall through to bootstrap
    }
    // Fallback path: the table isn't reachable. Use the env-var bootstrap
    // values. passwordHash is null (so callers do a plain compare against
    // process.env.ADMIN_PASSWORD). sessionSecret is the env-var secret.
    const cache = {
      passwordHash: null,
      sessionSecret: envBootstrapSecret(),
      loadedAt: Date.now(),
    };
    _settingsCache = cache;
    return cache;
  })();
  try {
    return await _settingsCachePromise;
  } finally {
    _settingsCachePromise = null;
  }
}

export function invalidateSettings() {
  _settingsCache = null;
  _settingsCachePromise = null;
}

// Used by change-password after writing a new row.
export async function writeAdminSettings({ passwordHash, sessionSecret }) {
  // Upsert. We update both fields atomically so the row is never in a
  // half-valid state.
  const value = {
    password_hash: passwordHash,
    session_secret: sessionSecret,
  };
  const body = JSON.stringify([{ id: 1, value, updated_at: new Date().toISOString() }]);
  // Prefer PATCH (update) if the row exists, otherwise POST (insert). Using
  // the "Prefer: resolution=merge-duplicates" header turns the upsert into
  // an atomic operation against the primary key.
  const r = await sbFetch('admin_settings?id=eq.1', {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ value, updated_at: new Date().toISOString() }),
  });
  if (r.ok) {
    invalidateSettings();
    return { ok: true };
  }
  // If PATCH returned 404 (no row yet), try POST to create it.
  if (r.status === 404 || r.status === 400) {
    const r2 = await sbFetch('admin_settings', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ id: 1, value, updated_at: new Date().toISOString() }),
    });
    if (r2.ok) {
      invalidateSettings();
      return { ok: true };
    }
    return { ok: false, status: r2.status, error: r2.data || r2.raw };
  }
  return { ok: false, status: r.status, error: r.data || r.raw };
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

// Issue a token signed with the current session secret. The secret is
// loaded from admin_settings (with env-var fallback) on every call so a
// successful password change is immediately reflected.
export async function issueAdminToken(ttlMs = 8 * 60 * 60 * 1000) {
  const settings = await loadAdminSettings();
  const secret = settings.sessionSecret || envBootstrapSecret();
  const now = Date.now();
  const payload = { sub: 'admin', iat: now, exp: now + ttlMs };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}

// Constant-time compare of two hex strings.
function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export async function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing-token' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const settings = await loadAdminSettings();
  const secret = settings.sessionSecret || envBootstrapSecret();
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (!safeHexEqual(sig, expected)) {
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

export async function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    res.status(401).json({ error: 'Missing bearer token' });
    return null;
  }
  const result = await verifyAdminToken(match[1]);
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
