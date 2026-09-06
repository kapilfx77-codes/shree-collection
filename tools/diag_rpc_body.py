"""Check the deployed RPC body by triggering a check via SQL introspection.
We can't directly access pg_proc via PostgREST, but we can check
pg_catalog via SQL function... but the API only exposes /rest/v1/rpc/.
Let's check by testing: if FOR UPDATE is missing, we should see 10/10
succeed with stock=1 (the simple WHERE qty>=p_qty can race in concurrent
Postgres transactions if isolation is set differently).
"""
import os, json, urllib.request, urllib.error
import concurrent.futures

SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'
KEY = None
for line in open('.env.local'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
        break
assert KEY

def http(method, path, body=None):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    url = SUPABASE_URL + '/rest/v1/' + path
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode('utf-8', errors='replace')
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# Reset stock=10
http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 10})

# Fire 10 concurrent with stock=10 -> all should succeed (FOR UPDATE doesn't limit total throughput)
def call(i):
    return http('POST', 'rpc/decrement_inventory',
                {'p_product_id': 1, 'p_color': 'Red', 'p_size': 'M', 'p_qty': 1})

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = [f.result() for f in [ex.submit(call, i) for i in range(10)]]

ok = sum(1 for s, b in results if s == 200 and isinstance(b, list) and len(b) > 0)
empty = sum(1 for s, b in results if s == 200 and isinstance(b, list) and len(b) == 0)
err = sum(1 for s, b in results if s != 200)
print(f"stock=10, 10 concurrent: ok={ok} empty={empty} err={err}")

# Check final
s, b = http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f"final stock: {b}")

# Now stock=10, 30 concurrent calls with p_qty=1 — only 10 should succeed
http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 10})

with concurrent.futures.ThreadPoolExecutor(max_workers=30) as ex:
    results = [f.result() for f in [ex.submit(call, i) for i in range(30)]]

ok = sum(1 for s, b in results if s == 200 and isinstance(b, list) and len(b) > 0)
empty = sum(1 for s, b in results if s == 200 and isinstance(b, list) and len(b) == 0)
err = sum(1 for s, b in results if s != 200)
print(f"stock=10, 30 concurrent: ok={ok} empty={empty} err={err}")
print(f"expected: ok=10 empty=20")

s, b = http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f"final stock: {b}")

http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100})
