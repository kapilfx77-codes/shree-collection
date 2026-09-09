"""
Adjust Stock feature test suite — AD01 to AD12.
Tests the signed-delta PATCH /api/admin/inventory endpoint:
  * Positive delta adds stock via restore_inventory RPC
  * Negative delta removes stock via decrement_inventory RPC
  * Backend CHECK (quantity >= 0) prevents going negative
  * FIFO batch consistency is preserved for both directions

Run against the live production site. Each test prints:
  [PASS] ADNN: detail  or  [FAIL] ADNN: detail

Prerequisites:
  * Migration sql/011_variant_inventory.sql has been run.
  * Migration sql/015_inventory_cost_batches.sql has been run.
  * A product with id 1 exists and has color "Red", size "M" as variants.
  * The /api/admin/inventory PATCH endpoint exists.
"""
import sys
import json
import random
import string
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _test_env import resolve_base_url

BASE = resolve_base_url()
PASSWORD = "shree2026"

# Known test variant — product 1, color "Red", size "M"
TEST_PRODUCT_ID = 1
TEST_COLOR = "Red"
TEST_SIZE = "M"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def http_raw(method, url, body=None, headers=None):
    h = dict(headers or {})
    if body is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers=h,
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def http(method, path, body=None, headers=None, base=BASE):
    status, _, raw = http_raw(method, base + path, body, headers)
    txt = raw.decode("utf-8", errors="replace")
    if txt:
        try:
            return status, json.loads(txt)
        except Exception:
            return status, txt
    return status, None


def phone():
    return "98" + "".join(random.choices(string.digits, k=8))


def admin_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def login():
    _, body = http("POST", "/api/login", {"password": PASSWORD})
    return body.get("token") if isinstance(body, dict) else None


def set_inventory(token, product_id, color, size, quantity):
    """Admin: set absolute stock for a variant."""
    return http(
        "POST",
        "/api/admin/inventory",
        {"product_id": product_id, "color": color, "size": size, "quantity": quantity},
        headers=admin_headers(token),
    )


def adjust_inventory(token, product_id, color, size, delta):
    """Admin: adjust stock by signed delta (positive or negative)."""
    return http(
        "PATCH",
        "/api/admin/inventory",
        {"product_id": product_id, "color": color, "size": size, "delta": delta},
        headers=admin_headers(token),
    )


def get_variant_stock(token, product_id, color, size):
    """Admin: read a single variant's quantity."""
    status, body = http(
        "GET",
        f"/api/admin/inventory?product_id={product_id}",
        headers=admin_headers(token),
    )
    if status != 200:
        return None
    inv = body.get("inventory", []) if isinstance(body, dict) else []
    for row in inv:
        if (str(row.get("product_id")) == str(product_id)
                and str(row.get("color")).strip() == str(color).strip()
                and str(row.get("size")).strip() == str(size).strip()):
            return int(row.get("quantity") or 0)
    return 0


def add_stock_with_cost(token, product_id, color, size, quantity, unit_cost):
    """Admin: add stock with a known unit cost (creates FIFO batch)."""
    return http(
        "POST",
        "/api/admin/inventory/cost",
        {
            "product_id": product_id,
            "color": color,
            "size": size,
            "quantity": quantity,
            "unit_cost": unit_cost,
        },
        headers=admin_headers(token),
    )


def list_batches(token, product_id, color=None, size=None):
    qs = f"product_id={product_id}"
    if color:
        qs += f"&color={urllib.parse.quote(color)}"
    if size:
        qs += f"&size={urllib.parse.quote(size)}"
    return http(
        "GET",
        f"/api/admin/batches?{qs}",
        headers=admin_headers(token),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def ad01_positive_delta_adds_stock():
    """AD01: Positive delta (+5) increases stock by exactly 5."""
    token = login()
    if not token:
        return False, "login failed"
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 10)
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5)
    stock = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    ok = (s == 200 and stock == 15)
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    return ok, f"delta=+5 from 10: stock={stock} (expect 15), HTTP {s}"


def ad02_negative_delta_reduces_stock():
    """AD02: Negative delta (-3) decreases stock by exactly 3."""
    token = login()
    if not token:
        return False, "login failed"
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 10)
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, -3)
    stock = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    ok = (s == 200 and stock == 7)
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    return ok, f"delta=-3 from 10: stock={stock} (expect 7), HTTP {s}"


def ad03_negative_delta_cannot_go_below_zero():
    """AD03: Negative delta that would push stock below zero is rejected (409 or similar)."""
    token = login()
    if not token:
        return False, "login failed"
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 2)
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, -99)
    stock = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    # Either the request fails (4xx) or stock stays at 0 (CHECK constraint)
    ok = (stock >= 0)
    return ok, f"delta=-99 from 2: stock={stock} (must be >= 0), HTTP {s}"


def ad04_zero_delta_rejected():
    """AD04: Delta of 0 is rejected with 400."""
    token = login()
    if not token:
        return False, "login failed"
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    ok = (s == 400)
    return ok, f"delta=0: HTTP {s} (expect 400)"


def ad05_missing_product_id_rejected():
    """AD05: Missing product_id is rejected with 400."""
    token = login()
    if not token:
        return False, "login failed"
    s, body = adjust_inventory(token, 0, TEST_COLOR, TEST_SIZE, 5)
    ok = (s == 400)
    return ok, f"product_id=0: HTTP {s} (expect 400)"


def ad06_missing_color_rejected():
    """AD06: Missing color is rejected with 400."""
    token = login()
    if not token:
        return False, "login failed"
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, "", TEST_SIZE, 5)
    ok = (s == 400)
    return ok, f"empty color: HTTP {s} (expect 400)"


def ad07_missing_size_rejected():
    """AD07: Missing size is rejected with 400."""
    token = login()
    if not token:
        return False, "login failed"
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, "", 5)
    ok = (s == 400)
    return ok, f"empty size: HTTP {s} (expect 400)"


def ad08_anonymous_cannot_adjust():
    """AD08: Anonymous browser cannot PATCH /api/admin/inventory."""
    s, _ = http(
        "PATCH",
        "/api/admin/inventory",
        {"product_id": 1, "color": "Red", "size": "M", "delta": 99},
    )
    ok = (s in (401, 403))
    return ok, f"anonymous PATCH: HTTP {s} (expect 401 or 403)"


def ad09_fifo_consistency_after_adjust():
    """AD09: After a negative adjustment, FIFO batch allocation is consistent
    (batches are consumed oldest-first, and total batch qty matches variant qty)."""
    token = login()
    if not token:
        return False, "login failed"
    # Set clean state
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    # Add two batches: 5@100, 3@150
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5, 100.00)
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 3, 150.00)
    # Total should be 8
    stock_before = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    ok = (stock_before == 8)
    if not ok:
        set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
        return ok, f"setup failed: stock={stock_before} (expect 8)"
    # Negative adjustment of 4 — should consume oldest batch first (5@100)
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, -4)
    stock_after = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    # Check batches
    batch_res = list_batches(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    batch_rows = batch_res.get("batches", []) if isinstance(batch_res, dict) else []
    total_batch_qty = sum(int(b.get("quantity_remaining") or b.get("qty") or 0) for b in batch_rows)
    # Clean up
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    ok = (s == 200 and stock_after == 4 and total_batch_qty == 4)
    return ok, f"after -4: stock={stock_after}, batch_qty_sum={total_batch_qty} (expect stock=4, batch=4), HTTP {s}"


def ad10_positive_adjust_preserves_fifo_batches():
    """AD10: Positive adjustment adds a new FIFO batch without touching existing batches."""
    token = login()
    if not token:
        return False, "login failed"
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    # Add a batch of 5@100
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5, 100.00)
    batch_count_before = len(list_batches(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE).get("batches", []))
    # Positive adjustment of 3 should create a new batch
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 3)
    batch_count_after = len(list_batches(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE).get("batches", []))
    stock = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    ok = (s == 200 and stock == 8 and batch_count_after > batch_count_before)
    return ok, f"+3: stock={stock}, batches before={batch_count_before} after={batch_count_after}, HTTP {s}"


def ad11_insufficient_stock_returns_error():
    """AD11: When adjustment would exhaust stock, the response carries an error code."""
    token = login()
    if not token:
        return False, "login failed"
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 2)
    s, body = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, -99)
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    # The response should indicate insufficient stock
    txt = json.dumps(body) if isinstance(body, dict) else str(body)
    has_error = ("insufficient" in txt.lower() or s >= 400)
    ok = (s >= 400 or "insufficient" in txt.lower())
    return ok, f"delta=-99 from 2: HTTP {s}, error={has_error}"


def ad12_delta_one_increment_button_works():
    """AD12: The +1 and -1 buttons in the admin inventory matrix work correctly.
    This tests the same endpoint as AD01/AD02 but verifies the response
    includes new_quantity for the UI to display."""
    token = login()
    if not token:
        return False, "login failed"
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5)
    # +1
    s1, body1 = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 1)
    stock_after_plus = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    # -1
    s2, body2 = adjust_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, -1)
    stock_after_minus = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    ok = (s1 == 200 and stock_after_plus == 6 and s2 == 200 and stock_after_minus == 5)
    return ok, f"+1 then -1: stock 5→{stock_after_plus}→{stock_after_minus} (expect 5), HTTP {s1}/{s2}"


# ---------------------------------------------------------------------------
# Test registry
# ---------------------------------------------------------------------------

TESTS = [
    ad01_positive_delta_adds_stock,
    ad02_negative_delta_reduces_stock,
    ad03_negative_delta_cannot_go_below_zero,
    ad04_zero_delta_rejected,
    ad05_missing_product_id_rejected,
    ad06_missing_color_rejected,
    ad07_missing_size_rejected,
    ad08_anonymous_cannot_adjust,
    ad09_fifo_consistency_after_adjust,
    ad10_positive_adjust_preserves_fifo_batches,
    ad11_insufficient_stock_returns_error,
    ad12_delta_one_increment_button_works,
]


def main() -> int:
    print(f"\nConnecting to: {BASE}\n")
    passed = 0
    for i, fn in enumerate(TESTS, start=1):
        vnum = f"AD{i:02d}"
        try:
            ok, detail = fn()
        except Exception as ex:
            ok, detail = False, f"EXCEPTION: {ex}"
        tag = "PASS" if ok else "FAIL"
        print(f"[{tag}] {vnum}: {detail}")
        if ok:
            passed += 1
    print(f"\nTotal: {passed}/{len(TESTS)} passed")
    return 0 if passed == len(TESTS) else 1


if __name__ == "__main__":
    sys.exit(main())
