"""
Probe: PATCH admin_settings directly via service-role key and see if
the new value actually persists to the database. This isolates whether
the Supabase REST PATCH is doing what we think it is, separate from
the change-password code path.

Compares:
  1. hashFp from the PATCH response (what the API says it wrote)
  2. hashFp from a follow-up GET (what's actually in the DB)
  3. hashFp from a follow-up GET 5s later (read-after-replication)
  4. Login with a known password matching the new hash
"""

import os
import json
import time
import hashlib
import urllib.request
import urllib.parse

# These are the URL and SERVICE ROLE key for our Supabase project.
# The service-role key bypasses RLS.
SUPABASE_URL = "https://xztfoauqecnmznszghcj.supabase.co"  # new project per SESSION_HANDOFF
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Fallback: read from .env.local
if not SERVICE_KEY:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                    SERVICE_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")

if not SERVICE_KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY not set. Aborting.")
    raise SystemExit(1)

def fingerprint(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]

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
        with urllib.request.urlopen(req, timeout=30) as resp:
            txt = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(txt)
            except json.JSONDecodeError:
                return resp.status, txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8")
        try:
            return e.code, json.loads(txt)
        except json.JSONDecodeError:
            return e.code, txt

# Step 1: Read the current row
status, before = sb("admin_settings?id=eq.1&select=value")
print(f"[1] GET current row: status={status}")
if status != 200 or not before:
    print("Could not read admin_settings. Aborting.")
    raise SystemExit(1)
before_hash = before[0]["value"].get("password_hash", "")
print(f"    current password_hash fingerprint: {fingerprint(before_hash) if before_hash else 'NONE'}")

# Step 2: PATCH with a known-value marker. We'll use a bcrypt-shaped string
# with a recognizable prefix so we can identify it on re-read.
# We DO NOT include the real plaintext password in this script.
MARKER_HASH = "$2a$10$.marker.probe." + "X" * 50
new_value = {
    "password_hash": MARKER_HASH,
    "session_secret": "probe-session-secret-" + str(int(time.time())),
}
status, patch_resp = sb(
    "admin_settings?id=eq.1",
    method="PATCH",
    headers={"Prefer": "return=representation"},
    body={"value": new_value, "updated_at": "2026-09-05T00:00:00Z"},
)
print(f"[2] PATCH marker: status={status}")
if isinstance(patch_resp, list) and patch_resp:
    print(f"    response row count: {len(patch_resp)}")
    ph = patch_resp[0].get("value", {}).get("password_hash", "")
    print(f"    response password_hash fingerprint: {fingerprint(ph) if ph else 'NONE'}")
else:
    print(f"    response (non-list): {json.dumps(patch_resp)[:200]}")

# Step 3: Immediate re-read
time.sleep(0.5)
status, after = sb("admin_settings?id=eq.1&select=value")
after_hash = after[0]["value"].get("password_hash", "") if status == 200 and after else ""
print(f"[3] GET after 0.5s: status={status}")
print(f"    after password_hash fingerprint: {fingerprint(after_hash) if after_hash else 'NONE'}")
print(f"    match with marker? {after_hash == MARKER_HASH}")

# Step 4: Re-read after a longer wait (in case of replication lag)
time.sleep(3)
status, after2 = sb("admin_settings?id=eq.1&select=value")
after2_hash = after2[0]["value"].get("password_hash", "") if status == 200 and after2 else ""
print(f"[4] GET after 3.5s: status={status}")
print(f"    password_hash fingerprint: {fingerprint(after2_hash) if after2_hash else 'NONE'}")

# Step 5: Re-read via a totally different path: PostgREST with no special
# header. (Just to make sure the cached response isn't fooling us.)
status, after3 = sb("admin_settings?select=password_hash")
after3_hash = ""
if status == 200 and after3:
    after3_hash = after3[0].get("password_hash", "")
print(f"[5] GET via different select: status={status}")
print(f"    password_hash fingerprint: {fingerprint(after3_hash) if after3_hash else 'NONE'}")
print(f"    === marker? {after3_hash == MARKER_HASH}")

# Step 6: Restore the original value (so we don't lock ourselves out)
print(f"[6] Restoring original hash...")
status, restore_resp = sb(
    "admin_settings?id=eq.1",
    method="PATCH",
    headers={"Prefer": "return=representation"},
    body={
        "value": {
            "password_hash": before_hash,
            "session_secret": before[0]["value"].get("session_secret", ""),
        },
        "updated_at": before[0].get("updated_at", "2026-09-05T00:00:00Z"),
    },
)
print(f"    restore status: {status}")
