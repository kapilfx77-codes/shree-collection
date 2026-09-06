"""Reproduce V16 by hitting the live Vercel /api/orders endpoint with 10
concurrent requests when stock=5."""
import os, sys, json, urllib.request, urllib.error
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

def login():
    s, b = http("POST", "/api/login", {"password": PASSWORD})
    return b.get("token") if isinstance(b, dict) else None

def phone():
    return "98" + "".join(random.choices(string.digits, k=8))

token = login()
assert token, "login failed"

# Set stock=5
http("POST", "/api/admin/inventory",
     {"product_id": 1, "color": "Red", "size": "M", "quantity": 5},
     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

print("=== 10 concurrent POST /api/orders, stock=5 ===")

def place(i):
    return http("POST", "/api/orders", {
        "name": "V16Test",
        "phone": phone() + f"X{i}",
        "city": "KTM", "address": "addr",
        "items": [{"id": 1, "color": "Red", "size": "M", "quantity": 1}],
        "paymentMethod": "esewa",
    })

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    results = [f.result() for f in [ex.submit(place, i) for i in range(10)]]

success = sum(1 for s, _ in results if s == 201)
conflict = sum(1 for s, _ in results if s == 409)
other = [r for r in results if r[0] not in (201, 409)]
print(f"201={success} 409={conflict} other={len(other)}")
for s, b in other:
    print(f"  other: {s} {b}")

# Reset
http("POST", "/api/admin/inventory",
     {"product_id": 1, "color": "Red", "size": "M", "quantity": 100},
     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
print("reset to 100")
