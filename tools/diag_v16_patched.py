"""Test: call /api/orders 10 times in quick succession, then check the Vercel logs
for the actual decrement responses to see if Vercel is returning duplicate responses.
"""
import concurrent.futures, json, random, string, sys, time, urllib.error, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _test_env import resolve_base_url

BASE = resolve_base_url()
PASSWORD = 'Kapil@Ef2618F'
SUPABASE_URL = 'https://xztfoauqecnmznszghcj.supabase.co'

# Read service key from .env.local
KEY = None
for line in open('.env.local'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
        break

def http(method, url, body=None, headers=None):
    h = dict(headers or {})
    if body and 'Content-Type' not in h:
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

def http2(method, path, body=None, headers=None):
    s, t = http(method, BASE + path, body, headers)
    try:
        return s, json.loads(t)
    except:
        return s, t

def phone():
    return '98' + ''.join(random.choices(string.digits, k=8))

# Login
_, b = http2('POST', '/api/login', {'password': PASSWORD})
token = b.get('token') if isinstance(b, dict) else None
print('login:', 'ok' if token else 'FAIL')

# Set stock to 5 via direct Supabase
def supabase(method, path, body=None):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    s, t = http(method, SUPABASE_URL + '/rest/v1/' + path, body, h)
    try:
        return s, (json.loads(t) if t else None)
    except:
        return s, t

s, _ = supabase('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 5, 'reserved': 0})
print(f'set stock: {s}')
s, b = supabase('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f'stock before: {b}')

# Clear old Vercel logs (by reading current ones)
print('\nFiring 10 concurrent orders...')
t0 = time.time()

def place(i):
    s, t = http('POST', BASE + '/api/orders', {
        'name': 'Diag3', 'phone': phone() + f'-d3-{i}',
        'city': 'KTM', 'address': 'X',
        'items': [{'id': 1, 'color': 'Red', 'size': 'M', 'quantity': 1}],
        'paymentMethod': 'esewa',
    })
    return (i, s, t[:100])

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = sorted([f.result() for f in [ex.submit(place, i) for i in range(10)]], key=lambda r: r[0])

print(f'Done in {time.time()-t0:.2f}s')
success = fail = 0
for i, s, body in results:
    if s == 201: success += 1
    else: fail += 1
    print(f'  [{i:2d}] {s}: {body[:80]}')
print(f'{success}/10 success, {fail}/10 fail')

s, b = supabase('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity')
print(f'stock after: {b}')

supabase('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', {'quantity': 100, 'reserved': 0})
print('reset to 100')
