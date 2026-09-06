"""V16 diagnostic - runs V16 and prints the raw 201/409 response bodies
plus the actual inventory after, to figure out why 7/10 succeed when
FOR UPDATE should limit to 5/10.
"""
import concurrent.futures
import json
import random
import string
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _test_env import resolve_base_url

BASE = resolve_base_url()
PASSWORD = "Kapil@Ef2618F"
TEST_PRODUCT_ID = 1
TEST_COLOR = "Red"
TEST_SIZE = "M"


def http(method, url, body=None, headers=None):
    h = dict(headers or {})
    if body is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode() if body is not None else None,
        headers=h, method=method,
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def http2(method, path, body=None, headers=None):
    status, _, raw = http(method, BASE + path, body, headers)
    txt = raw.decode("utf-8", errors="replace")
    if txt:
        try:
            return status, json.loads(txt)
        except Exception:
            return status, txt
    return status, None


def phone():
    return "98" + "".join(random.choices(string.digits, k=8))


def login():
    _, b = http2("POST", "/api/login", {"password": PASSWORD})
    return b.get("token") if isinstance(b, dict) else None


def set_inventory(token, pid, c, s, q):
    return http2("POST", "/api/admin/inventory",
                 {"product_id": pid, "color": c, "size": s, "quantity": q},
                 {"Authorization": f"Bearer {token}", "Content-Type": "application/json"})


def get_inventory(token, pid):
    s, b = http2("GET", f"/api/admin/inventory?product_id={pid}",
                 headers={"Authorization": f"Bearer {token}"})
    if isinstance(b, dict):
        for r in b.get("inventory", []):
            if r["color"] == TEST_COLOR and r["size"] == TEST_SIZE:
                return r.get("quantity")
    return None


def main():
    token = login()
    if not token:
        print("login failed")
        return
    print(f"Setting stock to 5...")
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5)
    actual_before = get_inventory(token, TEST_PRODUCT_ID)
    print(f"Stock before: {actual_before}")
    if actual_before != 5:
        print(f"WARNING: set_inventory did not land at 5 (got {actual_before}); retrying...")
        set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5)
        actual_before = get_inventory(token, TEST_PRODUCT_ID)
        print(f"Stock before (retry): {actual_before}")

    def place(i):
        s, _, raw = http("POST", BASE + "/api/orders",
                          {"name": "Diag", "phone": phone() + f"-d{i}",
                           "city": "KTM", "address": "X",
                           "items": [{"id": TEST_PRODUCT_ID, "color": TEST_COLOR,
                                      "size": TEST_SIZE, "quantity": 1}],
                           "paymentMethod": "esewa"},
                          {"Content-Type": "application/json"})
        return (i, s, raw.decode("utf-8", errors="replace")[:200])

    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        fs = [ex.submit(place, i) for i in range(10)]
        results = [f.result() for f in concurrent.futures.as_completed(fs)]
    print(f"10 orders fired in {time.time()-t0:.2f}s")

    # Sort by request index for stable output
    results.sort(key=lambda r: r[0])
    success = 0
    fail = 0
    for i, s, body in results:
        kind = "201" if s == 201 else ("409" if s == 409 else f"HTTP{s}")
        if s == 201:
            success += 1
        else:
            fail += 1
        print(f"  [{i:2d}] {kind}: {body}")

    print(f"\n{success}/10 success, {fail}/10 fail")
    actual_after = get_inventory(token, TEST_PRODUCT_ID)
    print(f"Stock after: {actual_after}")
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 100)


if __name__ == "__main__":
    main()
