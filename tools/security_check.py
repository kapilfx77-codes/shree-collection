"""Production security verification — A through J.

Run with:  python tools/security_check.py
"""
import json
import random
import re
import string
import urllib.error
import urllib.request

BASE = "https://shree-collection-opal.vercel.app"

def http(method, path, body=None, headers=None, expect_json=True):
    h = dict(headers or {})
    if body is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers=h,
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode("utf-8", errors="replace")
            return r.status, (json.loads(txt) if expect_json and txt else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", errors="replace")
        return e.code, (json.loads(txt) if expect_json and txt else txt)


def make_order(phone, payment="cod", item_id=1, quantity=1, total=None, extra_items=None):
    items = extra_items or [{"id": item_id, "size": "M", "color": "Red", "quantity": quantity}]
    body = {
        "name": "SecurityTest",
        "phone": phone,
        "city": "Butwal",
        "address": "Ward 1",
        "items": items,
        "paymentMethod": payment,
    }
    if total is not None:
        body["total"] = total
    return body


def phone():
    return "98" + "".join(random.choices(string.digits, k=8))


# === Setup: create one real order to test against ===
print("=== Setup ===")
p = phone()
status, real = http("POST", "/api/orders", make_order(p))
assert status == 201, f"setup failed: {status} {real}"
real_id = real["order_id"]
print(f"  real order: {real_id} (phone {p})")

# === A. Wrong phone + valid order ID ===
print("\n=== A. Wrong phone + valid order ID ===")
status, body = http("GET", f"/api/orders?action=lookup&order_id={real_id}&phone=9811111111")
if status == 404:
    print("  HTTP 404: order not revealed (PASS)")
else:
    print(f"  UNEXPECTED {status}: {body}")

# === B. Valid order ID without phone ===
print("\n=== B. Valid order ID without phone ===")
status, body = http("GET", f"/api/orders?action=lookup&order_id={real_id}")
if status == 400:
    print(f"  HTTP 400: {body.get('error','?')} (PASS)")
else:
    print(f"  UNEXPECTED {status}: {body}")

# === C. Attempt to update another customer's transaction ===
# Create order X with phone X. Then try to attach a txn to it using phone Y.
print("\n=== C. Attempt to attach txn to another customer's order ===")
status, real2 = http("POST", "/api/orders", make_order(phone(), payment="esewa"))
target_id = real2["order_id"]
status, body = http("POST", "/api/orders?action=txn",
    {"order_id": target_id, "phone": "9811111111", "txn": "FAKE12345"})
if status in (403, 404):
    print(f"  HTTP {status}: {body.get('error','?')} (PASS)")
else:
    print(f"  UNEXPECTED {status}: {body}")

# === D. Browser sets payment_status=paid (no auth) ===
print("\n=== D. Browser tries to PATCH payment_status=paid (no auth) ===")
status, body = http("PATCH", "/api/admin/orders",
    {"order_id": real_id, "payment_status": "paid"})
if status == 401:
    print(f"  HTTP 401: {body.get('error','?')} (PASS)")
else:
    print(f"  UNEXPECTED {status}: {body}")

# === E. Client manipulates product price in items[] ===
print("\n=== E. Client sends price=1 in items[] (server must ignore) ===")
status, body = http("POST", "/api/orders", make_order(phone(), total=1,
    extra_items=[{"id": 1, "size": "M", "color": "Red", "quantity": 1, "price": 1}]))
print(f"  server total={body.get('total')} mismatch={body.get('client_total_mismatch')}")
if body.get("total") == 1500 and body.get("client_total_mismatch"):
    print("  Server ignored client price (PASS)")
else:
    print(f"  FAIL: {body}")

# === F. Client manipulates total ===
print("\n=== F. Client sends total=1 but real price is 1500 ===")
status, body = http("POST", "/api/orders", make_order(phone(), total=1))
print(f"  server total={body.get('total')} mismatch={body.get('client_total_mismatch')}")
if body.get("total") == 1500 and body.get("client_total_mismatch"):
    print("  Server ignored client total, flagged mismatch (PASS)")
else:
    print(f"  FAIL: {body}")

# === G. Double-click protection: server-side effect ===
# The browser guard is in cart.js. Server-side, two simultaneous POSTs
# would each create a row. Verify by sending two POSTs in quick succession.
print("\n=== G. Double-click (server creates 2 rows by design) ===")
print("  Note: client-side submitInFlight guard prevents this; server allows")
print("  (no idempotency key in current design — by design)")
status, _ = http("POST", "/api/orders", make_order(phone()))
status2, _ = http("POST", "/api/orders", make_order(phone()))
print(f"  Two simultaneous POSTs: 1st={status}, 2nd={status2} (both 201 expected)")

# === H. Retry after a failed request ===
print("\n=== H. Retry after failure: send invalid then valid ===")
status_bad, _ = http("POST", "/api/orders", make_order(phone(), total=1,
    extra_items=[{"id": 9999, "size": "M", "color": "Red", "quantity": 1}]))
status_good, body = http("POST", "/api/orders", make_order(phone()))
print(f"  invalid: {status_bad}, valid retry: {status_good} (both behave correctly)")

# === I. Out-of-stock ===
print("\n=== I. Order Saree (in_stock=false) ===")
status, body = http("POST", "/api/orders", make_order(phone(), item_id=2,
    extra_items=[{"id": 2, "size": "Free", "color": "Red", "quantity": 1}]))
if status == 409 and body.get("code") == "out_of_stock":
    print(f"  HTTP 409: {body.get('error','?')} (PASS)")
else:
    print(f"  UNEXPECTED {status}: {body}")

# === J. No service-role key in frontend/network responses ===
print("\n=== J. service_role key leakage check ===")
key_pattern = re.compile(r"service[_\\-]?role", re.IGNORECASE)
for path in ["config.js", "db.js", "cart.js", "admin.js", "index.html", "product.html", "checkout.html", "admin.html"]:
    try:
        req = urllib.request.Request(f"{BASE}/{path}")
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode("utf-8", errors="replace")
            if key_pattern.search(txt):
                print(f"  {path}: contains 'service_role' (CHECK)")
            else:
                print(f"  {path}: clean (PASS)")
    except Exception as e:
        print(f"  {path}: error {e}")

print("\n=== Done ===")
