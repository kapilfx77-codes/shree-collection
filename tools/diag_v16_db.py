"""Check the actual final stock after the V16 test ran."""
import sys, json, urllib.request, urllib.error
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

# Login
s, b = http("POST", "/api/login", {"password": PASSWORD})
token = b.get("token")
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Read current stock for product 1 / Red / M
s, b = http("GET", "/api/admin/inventory?product_id=1", headers=headers)
inv = b.get("inventory", [])
red_m = [r for r in inv if str(r.get("color")).strip() == "Red" and str(r.get("size")).strip() == "M"]
print("Product 1 / Red / M stock:", red_m)
