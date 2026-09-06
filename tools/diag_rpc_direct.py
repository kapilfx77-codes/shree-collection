"""Test the SQL function directly with the service role key.
Bypasses the Vercel API entirely.
"""
import os
import sys
import json
import urllib.request
import urllib.error
import concurrent.futures

SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'
KEY = None
for line in open('.env.local'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
        break
assert KEY, 'no key'

def http(method, path, body=None):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    url = SUPABASE_URL + '/rest/v1/' + path
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode('utf-8', errors='replace')
            if not text:
                return r.status, None
            return r.status, json.loads(text)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# Set stock to 1 using PATCH
s, b = http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 1, 'reserved': 0})
print('set 1:', s, repr(b)[:100])

# Read pg_proc to see the function source via SQL via the public schema introspection
# We can use the pg_catalog views
s, b = http('GET', 'pg_proc?proname=eq.decrement_inventory&select=proname,prosrc')
print('pg_proc:', s, b)

print()
print('=== Direct concurrent call: stock=1, 10 concurrent decrement ===')

# Set back to 1 first
http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 1, 'reserved': 0})  # empty body OK

def call(i):
    return http('POST', 'rpc/decrement_inventory',
                {'p_product_id': 1, 'p_color': 'Red', 'p_size': 'M', 'p_qty': 1})

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = [f.result() for f in [ex.submit(call, i) for i in range(10)]]

empty = 0
nonempty = 0
for s, b in results:
    if isinstance(b, list) and len(b) == 0:
        empty += 1
    elif isinstance(b, list) and len(b) > 0:
        nonempty += 1
        print(f'  ok: {b[0]}')
    else:
        print(f'  ERROR: status={s} body={b}')

print(f'empty={empty} nonempty={nonempty}')

# Check final
s, b = http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print('final stock:', b)

# Reset
http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100, 'reserved': 0})
print('reset to 100')
