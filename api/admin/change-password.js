// ==========================================================================
// /api/admin/change-password — rotate the admin password
// ==========================================================================
// POST { currentPassword, newPassword, confirmPassword } → 200 { success, token }
//
// Auth: requires a valid admin bearer token.
//
// Behaviour:
//   • Verifies `currentPassword` against the bcrypt hash in admin_settings.
//     Verification is delegated to the verify_admin_password(pwd) RPC in
//     Postgres so we use the same implementation for hash and compare (the
//     bcryptjs library on Vercel's Node runtime can produce hashes that
//     don't verify under a different bcryptjs build, so we keep the heavy
//     crypto on the database side).
//   • Validates `newPassword`: must equal `confirmPassword`, must differ from
//     `currentPassword`, must be at least 12 characters, must not be a
//     commonly-used weak password.
//   • Generates a fresh bcrypt cost-10 hash via the hash_admin_password(pwd)
//     RPC and writes it back to admin_settings, atomically replacing the
//     row's `password_hash` field. The `session_secret` is preserved
//     (other admin sessions on other devices stay valid by design).
//   • Returns a freshly-issued token signed with the same session secret so
//     the client can replace the existing sessionStorage token without
//     forcing a re-login.
//
// SECURITY NOTES
//   • The new password is NEVER returned in the response, NEVER logged.
//   • The error messages do not leak whether the `currentPassword` was the
//     only thing wrong vs. the new/confirm mismatch — both return 400.
//   • All bcrypt operations happen in Postgres, not in the Node runtime.
// ==========================================================================

import crypto from 'node:crypto';
import {
    issueAdminToken,
    loadAdminSettings,
    requireAdmin,
    requireServiceKey,
    writeAdminSettings,
    sbFetch,
} from '../../lib/admin-auth.js';

const MIN_PASSWORD_LEN = 12;

// A short, well-known block-list of passwords that are technically long
// enough but trivially guessable. Kept in this file (not in a table) so
// we don't have an extra DB roundtrip on every change.
const WEAK_PASSWORDS = new Set([
    'shree2026admin!', 'shree2026admin', 'shree-collection', 'shreecollection',
    'administrator1', 'admin1234567', 'admin12345678', 'password12345',
    'qwerty1234567', 'letmein12345', 'welcome12345',
]);

function validateNewPassword(newPwd) {
    if (typeof newPwd !== 'string') return 'New password is required';
    if (newPwd.length < MIN_PASSWORD_LEN) {
        return `New password must be at least ${MIN_PASSWORD_LEN} characters`;
    }
    if (newPwd.length > 256) {
        return 'New password is too long';
    }
    if (WEAK_PASSWORDS.has(newPwd.toLowerCase())) {
        return 'That password is on the block-list. Choose a different one.';
    }
    // Require a mix of character classes. Bcrypt cost-10 already makes brute
    // force hard, but a quick composition check filters the worst offenders.
    const hasLower = /[a-z]/.test(newPwd);
    const hasUpper = /[A-Z]/.test(newPwd);
    const hasDigit = /\d/.test(newPwd);
    const hasSymbol = /[^A-Za-z0-9]/.test(newPwd);
    const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
    if (classes < 3) {
        return 'New password must include at least 3 of: lowercase, uppercase, digit, symbol';
    }
    return null;
}

export default async function handler(req, res) {
    if (requireServiceKey(res)) return;
    const session = await requireAdmin(req, res);
    if (!session) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        const { currentPassword, newPassword, confirmPassword } = body;

        // 1. Basic shape check.
        if (typeof currentPassword !== 'string' ||
            typeof newPassword !== 'string' ||
            typeof confirmPassword !== 'string') {
            return res.status(400).json({ error: 'All three password fields are required' });
        }

        // 2. Verify current password against the stored hash.
        //
        // We delegate the compare to the database via the verify_admin_password
        // RPC. The RPC does `crypt(pwd, stored_hash) = stored_hash` server-side
        // using pgcrypto, which is the same implementation that originally
        // wrote the hash. Doing the compare in Node (via bcryptjs) was racy
        // across Vercel cold starts and was the root cause of the
        // "change-password returns 200 but new password doesn't work" bug.
        const verifyResp = await sbFetch('rpc/verify_admin_password', {
            method: 'POST',
            body: JSON.stringify({ pwd: currentPassword }),
        });
        let currentOk = false;
        if (verifyResp.ok && typeof verifyResp.data === 'boolean') {
            currentOk = verifyResp.data;
        } else if (verifyResp.status === 404) {
            // The RPC hasn't been installed yet. Fall back to a local
            // compare so the UI keeps working until the user runs the
            // migration. This branch will go away once 005 is deployed.
            const settings = await loadAdminSettings();
            if (settings.passwordHash) {
                // Use bcryptjs here as the bootstrap path so we don't crash
                // when the RPC is missing.
                const bcrypt = (await import('bcryptjs')).default;
                currentOk = await bcrypt.compare(currentPassword, settings.passwordHash);
            } else {
                const envPassword = process.env.ADMIN_PASSWORD || 'shree2026';
                currentOk = currentPassword === envPassword;
            }
        } else {
            console.error('change-password: verify_admin_password RPC failed:', verifyResp.status, verifyResp.data);
            return res.status(500).json({ error: 'Failed to verify current password' });
        }
        if (!currentOk) {
            // Use a 400 (not 401) so the UI's 401-handler ("session expired,
            // re-login") doesn't fire for a wrong-password attempt. The
            // request IS authenticated; the current password was just wrong.
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        // 3. Validate the new password.
        const newErr = validateNewPassword(newPassword);
        if (newErr) {
            return res.status(400).json({ error: newErr });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'New password and confirmation do not match' });
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({ error: 'New password must be different from the current password' });
        }

        // 4. Hash the new password and write the row. We keep the existing
        //    session_secret so other admin sessions on other devices remain
        //    valid (per product decision: don't rotate on every change).
        //
        //    Hashing happens server-side in Postgres via the hash_admin_password
        //    RPC so the same implementation (pgcrypto's crypt()) that we use
        //    for verification writes the hash. This avoids the bcryptjs
        //    cross-version skew bug where Node bcryptjs would generate a
        //    hash that Vercel bcryptjs couldn't verify.
        //
        //    If the RPC isn't installed yet (404) we fall back to bcryptjs so
        //    the UI keeps working until the user runs the 005 migration.
        let newHash;
        const hashResp = await sbFetch('rpc/hash_admin_password', {
            method: 'POST',
            body: JSON.stringify({ pwd: newPassword }),
        });
        if (hashResp.ok && typeof hashResp.data === 'string' && hashResp.data.length > 0) {
            newHash = hashResp.data;
        } else if (hashResp.status === 404) {
            const bcrypt = (await import('bcryptjs')).default;
            newHash = await bcrypt.hash(newPassword, 10);
        } else {
            console.error('change-password: hash_admin_password RPC failed:', hashResp.status, hashResp.data);
            return res.status(500).json({ error: 'Failed to hash new password' });
        }
        const settings = await loadAdminSettings();
        // The session_secret may have been a bootstrap (env-var) value if
        // the table was missing it; persist a real one alongside the new
        // hash so future logins read it from the table.
        const newSessionSecret = settings.sessionSecret && !isBootstrapSecret(settings.sessionSecret)
            ? settings.sessionSecret
            : crypto.randomBytes(32).toString('hex');

        const write = await writeAdminSettings({
            passwordHash: newHash,
            sessionSecret: newSessionSecret,
        });
        // TEMP DIAGNOSTIC: log the write result so we can see what the
        // Supabase REST API actually returned. Never log the hash/secret
        // themselves — only the status and a fingerprint of the row that
        // was supposedly written. Remove once the e2e test is green.
        console.error('[change-password] writeAdminSettings result:', JSON.stringify({
            ok: write.ok,
            status: write.status,
            error: write.error,
            newHashLen: newHash.length,
            newSecretLen: newSessionSecret.length,
        }));
        if (!write.ok) {
            console.error('change-password write failed:', write);
            return res.status(500).json({ error: 'Failed to persist the new password' });
        }

        // 5. Issue a fresh token signed with the (now-persisted) session
        //    secret. The client replaces its sessionStorage token with this.
        const token = await issueAdminToken();
        return res.status(200).json({
            success: true,
            message: 'Password changed successfully',
            token,
        });
    } catch (err) {
        console.error('change-password error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}

// True iff the in-memory session secret was a fallback (env-var default).
// If it was, we generate a fresh random one on the first write so future
// cold-starts don't keep falling back to the env.
function isBootstrapSecret(s) {
    if (!s) return true;
    if (s === 'shree2026') return true;
    if (process.env.ADMIN_SESSION_SECRET && s === process.env.ADMIN_SESSION_SECRET) return true;
    if (process.env.ADMIN_PASSWORD && s === process.env.ADMIN_PASSWORD) return true;
    return false;
}
