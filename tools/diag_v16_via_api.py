"""Direct V16 test that bypasses set_inventory and uses direct Supabase RPC
to both set stock AND place orders, to see if the bug is in set_inventory or in orders.js.
"""
import os, sys, json, urllib.request, urllib.error, concurrent.futures, time, random, string

SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'
KEY = None
for line in open('.env.local'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
        break
BASE = 'https://shree-collection-opal.vercel.app'
PASSWORD = 'Kapil@Ef2618F'

def http_supabase(method, path, body=None):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    url = SUPABASE_URL + '/rest/v1/' + path
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode('utf-8', errors='replace')
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

def http_api(method, url, body=None, headers=None):
    h = dict(headers or {})
    if body and 'Content-Type' not in h:
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

def phone():
    return '98' + ''.join(random.choices(string.digits, k=8))

# Login
_, b = http_api('POST', BASE + '/api/login', {'password': PASSWORD})
token = b.get('token') if isinstance(b, dict) else None
print('login:', 'ok' if token else 'FAIL')

# Step 1: Set stock to 5 via direct Supabase PATCH
s, b = http_supabase('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M',
                      {'quantity': 5, 'reserved': 0})
print(f'set stock to 5 via PATCH: {s}')

# Verify
s, b = http_supabase('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f'verify stock: {b}')

# Step 2: Fire 10 concurrent orders via /api/orders
def place_order(i):
    s, b = http_api('POST', BASE + '/api/orders', {
        'name': 'DiagV2',
        'phone': phone() + f'-dv2-{i}',
        'city': 'Kathmandu',
        'address': 'Test',
        'items': [{'id': 1, 'color': 'Red', 'size': 'M', 'quantity': 1}],
        'paymentMethod': 'esewa',
    })
    return (i, s, b)

print(f'\nFiring 10 concurrent orders (stock=5, qty=1 each)...')
t0 = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = [f.result() for f in [ex.submit(place_order, i) for i in range(10)]]
print(f'Done in {time.time()-t0:.2f}s')

results.sort(key=lambda r: r[0])
success = fail = 0
for i, s, b in results:
    kind = '201' if s == 201 else ('409' if s == 409 else f'{s}')
    if s == 201: success += 1
    else: fail += 1
    b_str = json.dumps(b) if isinstance(b, dict) else str(b)[:100]
    print(f'  [{i:2d}] {kind}: {b_str[:120]}')

print(f'\n{success}/10 success, {fail}/10 fail')

# Check final stock
s, b = http_supabase('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f'final stock: {b}')

# Reset
http_supabase('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100, 'reserved': 0})
print('reset to 100')
