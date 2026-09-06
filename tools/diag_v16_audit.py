"""Run V16 and check: 
   - how many orders got 201
   - what's the final stock
   - is it consistent (no negative stock, no over-sell)?
"""
import sys, json, urllib.request, urllib.error
import concurrent.futures, random, string
sys.path.insert(0, 'tools')
from _test_env import resolve_base_url

BASE = resolve_base_url()
PASSWORD = "Kapil@Ef2618F"

def http(method, path, body=None, headers=None, base=BASE):
    h = dict(headers or {})
    if body is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8", "replace") or "null")

def phone():
    return "98" + "".join(random.choices(string.digits, k=8))

# Login
s, b = http("POST", "/api/login", {"password": PASSWORD})
token = b.get("token")
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Set stock=5
http("POST", "/api/admin/inventory",
     {"product_id": 1, "color": "Red", "size": "M", "quantity": 5},
     headers=headers)

# Read before
s, b = http("GET", "/api/admin/inventory?product_id=1", headers=headers)
red_m_before = [r for r in b.get("inventory", []) if r.get("color") == "Red" and r.get("size") == "M"][0]["quantity"]
print(f"Before: stock = {red_m_before}")

# 10 concurrent
def place(i):
    return http("POST", "/api/orders", {
        "name": "V16Audit",
        "phone": phone() + f"X{i}",
        "city": "KTM", "address": "addr",
        "items": [{"id": 1, "color": "Red", "size": "M", "quantity": 1}],
        "paymentMethod": "esewa",
    })

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = [f.result() for f in [ex.submit(place, i) for i in range(10)]]

success = sum(1 for s, _ in results if s == 201)
conflict = sum(1 for s, _ in results if s == 409)
other = [(s, b) for s, b in results if s not in (201, 409)]

# Read after
s, b = http("GET", "/api/admin/inventory?product_id=1", headers=headers)
red_m_after = [r for r in b.get("inventory", []) if r.get("color") == "Red" and r.get("size") == "M"][0]["quantity"]
print(f"After:  stock = {red_m_after}")
print(f"201={success} 409={conflict} other={len(other)}")
for s, b in other:
    print(f"  other: {s} {b}")

# Critical audit: was the final stock 5-success? Or did it go negative?
expected_final = red_m_before - success
print(f"Expected final stock (before - success): {expected_final}")
print(f"Actual final stock: {red_m_after}")
print(f"Match: {red_m_after == expected_final}")
print(f"Negative? {red_m_after < 0}")

# Reset
http("POST", "/api/admin/inventory",
     {"product_id": 1, "color": "Red", "size": "M", "quantity": 100},
     headers=headers)
print("reset to 100")
