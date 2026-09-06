"""Try to run raw SQL against Supabase via the service role key.
We attempt two approaches:
 1. POST /rest/v1/rpc/<some_function> with the SQL as a body (won't work for arbitrary DDL)
 2. Use the pg_catalog introspection to verify the current state of the grants.
If we can't run DDL, we can still verify the security hole exists and document it.
"""
import json, urllib.request, urllib.error

SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'
KEY = None
for line in open('.env.local'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
        break
assert KEY

def call(method, path, body=None, headers=None):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    if headers: h.update(headers)
    url = SUPABASE_URL + '/rest/v1/' + path
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode('utf-8', errors='replace')
            return r.status, text
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# 1. Check current grants via pg_proc + information_schema
# We can't query pg_proc directly, but we can try has_function_privilege
# via a custom RPC. Let's instead check by looking at the function via /rest/v1/.
# Actually, we can check who can call the RPC by attempting as anon.

# First, verify anon can still call it (as shown in V12):
import sys
sys.path.insert(0, 'tools')
from test_variant_inventory import get_inventory_anon
s, b = get_inventory_anon(1)
print(f"anon decrement_inventory: status={s} body={b[:100]}")
print(f"Anonymous CAN call decrement_inventory: {s == 200}")
