"""Test the SQL function exactly the same way the Vercel function does.
sbFetch sets:
  apikey: <service key>
  Authorization: Bearer <service key>
  Content-Type: application/json
  Prefer: return=representation
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
    h = {
        'apikey': KEY,
        'Authorization': f'Bearer {KEY}',
        'Content-Type': 'application/json',
    }
    url = SUPABASE_URL + '/rest/v1/' + path
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# Set stock to 1
s, b = http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 1, 'reserved': 0})
print('set 1:', s, repr(b)[:100])

# Read current to confirm
s, b = http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print('current:', b)

# Match sbFetch EXACTLY - 10 concurrent calls
def call(i):
    s, b = http('POST', 'rpc/decrement_inventory',
                 {'p_product_id': 1, 'p_color': 'Red', 'p_size': 'M', 'p_qty': 1})
    return (i, s, b)

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = [f.result() for f in [ex.submit(call, i) for i in range(10)]]

empty = 0
nonempty = 0
for i, s, b in results:
    try:
        parsed = json.loads(b) if b else None
    except:
        parsed = None
    if isinstance(parsed, list) and len(parsed) == 0:
        empty += 1
    elif isinstance(parsed, list) and len(parsed) > 0:
        nonempty += 1
        print(f'  call {i}: status={s} body={parsed}')
    else:
        print(f'  call {i}: status={s} body={parsed}')

print(f'\nempty={empty} nonempty={nonempty}')

# Check final
s, b = http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print('final stock:', b)

# Reset
http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100, 'reserved': 0})
print('reset to 100')
