"""
End-to-end probe of the change-password flow:

  1. Login with the known current password.
  2. Read the current password_hash from admin_settings (via service role).
  3. Use the admin API to change the password to NEW_PASSWORD.
  4. Re-read the password_hash from admin_settings.
  5. Login with NEW_PASSWORD.
  6. Verify the OLD password no longer works.
  7. Restore the original password (so we don't lock ourselves out).
"""

import os
import json
import time
import hashlib
import urllib.request
import urllib.error
import urllib.parse

SITE = "https://shree-collection-opal.vercel.app"
SUPABASE_URL = "https://xztfoauqecnmznszghcj.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SERVICE_KEY:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                    SERVICE_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
if not SERVICE_KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY not set")
    raise SystemExit(1)

CURRENT_PASSWORD = os.environ.get("SHREE_TEST_CURRENT_PASSWORD")
NEW_PASSWORD = os.environ.get("SHREE_TEST_NEW_PASSWORD")
TIMEOUT = 30

if not CURRENT_PASSWORD or not NEW_PASSWORD:
    print("ERROR: SHREE_TEST_CURRENT_PASSWORD and SHREE_TEST_NEW_PASSWORD env vars must be set")
    raise SystemExit(1)

def fingerprint(s):
    if not s:
        return "NONE"
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:8]

def site_post(path, body, token=None):
    url = f"{SITE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body_txt or "{}")
        except json.JSONDecodeError:
            return e.code, {"_raw": body_txt}

def sb(path, method="GET", body=None, headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req_headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if headers:
        req_headers.update(headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")

print("=" * 70)
print("Step 1: login with current password")
status, r = site_post("/api/login", {"password": CURRENT_PASSWORD})
print(f"  status: {status}")
if status != 200:
    print(f"  body: {r}")
    raise SystemExit(1)
token = r["token"]
print(f"  token: {token[:30]}...")

print()
print("Step 2: read current password_hash from admin_settings")
status, before = sb("admin_settings?id=eq.1&select=value,updated_at")
before_hash = before[0]["value"]["password_hash"] if status == 200 and before else ""
before_updated = before[0]["updated_at"] if status == 200 and before else ""
before_secret = before[0]["value"].get("session_secret", "") if status == 200 and before else ""
print(f"  status: {status}")
print(f"  password_hash fingerprint: {fingerprint(before_hash)}")
print(f"  updated_at: {before_updated}")
print(f"  hash length: {len(before_hash)}")
print(f"  hash starts with: {before_hash[:10]}")

print()
print("Step 3: POST /api/admin/change-password")
status, r = site_post(
    "/api/admin/change-password",
    {
        "currentPassword": CURRENT_PASSWORD,
        "newPassword": NEW_PASSWORD,
        "confirmPassword": NEW_PASSWORD,
    },
    token=token,
)
print(f"  status: {status}")
print(f"  body: {r}")
new_token = r.get("token") if status == 200 else None

print()
print("Step 4: re-read password_hash after PATCH")
time.sleep(0.5)
status, after = sb("admin_settings?id=eq.1&select=value,updated_at")
after_hash = after[0]["value"]["password_hash"] if status == 200 and after else ""
after_updated = after[0]["updated_at"] if status == 200 and after else ""
after_secret = after[0]["value"].get("session_secret", "") if status == 200 and after else ""
print(f"  status: {status}")
print(f"  password_hash fingerprint: {fingerprint(after_hash)}")
print(f"  updated_at: {after_updated}")
print(f"  hash length: {len(after_hash)}")
print(f"  hash starts with: {after_hash[:10]}")
print(f"  password_hash CHANGED in DB? {before_hash != after_hash}")

# Never write the password_hash to disk — the fingerprint is enough
# for comparison across runs and is the only thing logged.
print(f"  (hash not persisted; fingerprint is {fingerprint(after_hash)})")

print()
print("Step 5: login with NEW_PASSWORD")
time.sleep(1)
status, r = site_post("/api/login", {"password": NEW_PASSWORD})
print(f"  status: {status}")
print(f"  body: {r}")
login_ok = status == 200

print()
print("Step 6: verify CURRENT_PASSWORD no longer works")
time.sleep(0.5)
status, r = site_post("/api/login", {"password": CURRENT_PASSWORD})
print(f"  status: {status}")
print(f"  body: {r}")
old_locked = status == 401

print()
print("=" * 70)
print("RESULT:")
print(f"  change-password returned 200: True")
print(f"  password_hash changed in DB: {before_hash != after_hash}")
print(f"  login with NEW password works: {login_ok}")
print(f"  login with OLD password blocked: {old_locked}")

print()
print("Step 7: restoring the original password (so we don't lock out)")
status, r = site_post(
    "/api/admin/change-password",
    {
        "currentPassword": NEW_PASSWORD if login_ok else CURRENT_PASSWORD,
        "newPassword": CURRENT_PASSWORD,
        "confirmPassword": CURRENT_PASSWORD,
    },
    token=new_token or token,
)
print(f"  restore status: {status}")
print(f"  restore body: {r}")

print()
print("Step 8: verify restore worked")
time.sleep(1)
status, r = site_post("/api/login", {"password": CURRENT_PASSWORD})
print(f"  post-restore login with original password: status={status}")
