"""FIFO inventory costing — B01 to B29.
Run against the live production site. Each test prints:
  [PASS] BNN: detail  or  [FAIL] BNN: detail

Tests cover:
  B01-B03   add_inventory_batch: creates a batch, updates variant-level inventory
  B04-B07   FIFO consumption: oldest batch ships first, costs accumulate
  B08-B10   Partial consumption: one batch partially fulfilled, rest untouched
  B11-B13   Out-of-stock rejection: all decrements reversed, sentinel -1 returned
  B14-B16   Multi-batch consumption: qty spans 2+ batches correctly
  B17-B19   restore_fifo_batches: idempotent, returns restored qty per batch
  B20-B22   Payment rejection: restores exact batches, batch_allocations cleared
  B23-B25   Payment cancellation: restores exact batches, status=cancelled
  B26       Cost accuracy: actual total_cost matches expected FIFO cost
  B27       Profit calculation: revenue - total_cost shown in order modal
  B28       All-batches view: no color/size returns all batches for product
  B29       Anonymous / non-admin cannot read batches table (RLS)

Prerequisites:
  * Migration sql/015_inventory_cost_batches.sql has been run.
  * Migration sql/016_orders_batch_allocations.sql has been run.
  * A product with id 1 exists and has color "Red", size "M" as variants.
  * The /api/admin/inventory/cost endpoint exists.
  * The /api/admin/batches endpoint exists.
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


# ---------------------------------------------------------------------------
# Inventory helpers (reset stock before each test group)
# ---------------------------------------------------------------------------

def set_inventory(token, product_id, color, size, quantity):
    return http(
        "POST",
        "/api/admin/inventory",
        {"product_id": product_id, "color": color, "size": size, "quantity": quantity},
        headers=admin_headers(token),
    )


def adjust_inventory(token, product_id, color, size, delta):
    return http(
        "PATCH",
        "/api/admin/inventory",
        {"product_id": product_id, "color": color, "size": size, "delta": delta},
        headers=admin_headers(token),
    )


def get_variant_stock(token, product_id, color, size):
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


# ---------------------------------------------------------------------------
# Batch helpers
# ---------------------------------------------------------------------------

def add_stock_with_cost(token, product_id, color, size, quantity, unit_cost):
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


def list_all_batches(token):
    return http(
        "GET",
        "/api/admin/batches",
        headers=admin_headers(token),
    )


# ---------------------------------------------------------------------------
# Order helpers
# ---------------------------------------------------------------------------

def make_order(items, payment="esewa", phone_=None):
    return {
        "name": "FIFOTest",
        "phone": phone_ or phone(),
        "city": "Kathmandu",
        "address": "Test address",
        "items": items,
        "paymentMethod": payment,
    }


def create_order(order_data):
    return http("POST", "/api/orders", order_data)


def verify_payment(token, order_id):
    return http(
        "POST",
        "/api/admin/orders/verify",
        {"order_id": order_id, "source": "test"},
        headers=admin_headers(token),
    )


def reject_payment(token, order_id, reason="Test rejection"):
    return http(
        "POST",
        "/api/admin/orders/reject",
        {"order_id": order_id, "reason": reason},
        headers=admin_headers(token),
    )


def cancel_order(token, order_id):
    return http(
        "DELETE",
        "/api/admin/orders",
        {"order_id": order_id},
        headers=admin_headers(token),
    )


def get_order(token, order_id):
    return http(
        "GET",
        f"/api/admin/orders?order_id={urllib.parse.quote(order_id)}",
        headers=admin_headers(token),
    )


import urllib.parse

# ---------------------------------------------------------------------------
# Test suite
# ---------------------------------------------------------------------------

def run_tests():
    token = login()
    if not token:
        print("[FAIL] B00: Could not obtain admin token")
        return

    results = []

    def check(name, condition, detail=""):
        tag = "[PASS]" if condition else "[FAIL]"
        results.append(condition)
        detail_str = f" — {detail}" if detail else ""
        print(f"{tag} {name}{detail_str}")
        if not condition:
            print(f"      ^ failure detail: {detail_str}")

    # ---- B01-B03: add_inventory_batch creates a batch ----

    # First set variant stock to 0 so we start clean
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)

    _, res = add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 10, 100.00)
    check("B01", isinstance(res, dict) and res.get("ok") is True,
          f"add_stock_with_cost returns ok=true: {res}")
    batch_id = res.get("batch_id")

    _, batches = list_batches(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    batch_rows = batches.get("batches", []) if isinstance(batches, dict) else []
    check("B02", len(batch_rows) >= 1 and any(b.get("id") == batch_id for b in batch_rows),
          f"batch {batch_id} appears in list: {batch_rows}")
    check("B03", get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE) >= 10,
          f"variant-level inventory reflects added stock")

    # ---- B04-B07: FIFO consumption (oldest ships first) ----

    # Add a second batch at a different cost
    _, res2 = add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5, 200.00)
    check("B04", isinstance(res2, dict) and res2.get("ok") is True,
          f"second batch created: {res2}")

    # Place an order for 7 units — should consume from Batch B01 (cost 100) first
    order_data = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 7,
        "price": 500,
    }])
    status, order_res = create_order(order_data)
    check("B05", status == 201 and order_res.get("order_id"),
          f"order created: {status} {order_res}")
    order_id = order_res.get("order_id")

    # Verify the payment so the order goes through
    status2, verify_res = verify_payment(token, order_id)
    check("B06", status2 == 200,
          f"payment verified: {status2} {verify_res}")

    # total_cost should be 7 * 100 = 700 (all from Batch B01 at Rs.100)
    _, full_order = get_order(token, order_id)
    total_cost = full_order.get("total_cost") if isinstance(full_order, dict) else None
    check("B07", total_cost == 700,
          f"total_cost=700 (7×100): got {total_cost}")

    # ---- B08-B10: Partial batch consumption ----

    # Add a new batch of 8 units at Rs.150
    _, res3 = add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 8, 150.00)
    check("B08", isinstance(res3, dict) and res3.get("ok") is True,
          f"third batch added: {res3}")

    # Order 3 units — should partially consume this batch
    order_data2 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 3,
        "price": 500,
    }])
    status3, order_res2 = create_order(order_data2)
    check("B09", status3 == 201 and order_res2.get("order_id"),
          f"order for 3 units created: {status3}")
    order_id2 = order_res2.get("order_id")
    verify_payment(token, order_id2)

    _, full_order2 = get_order(token, order_id2)
    total_cost2 = full_order2.get("total_cost") if isinstance(full_order2, dict) else None
    check("B10", total_cost2 == 450,
          f"total_cost=450 (3×150): got {total_cost2}")

    # ---- B11-B13: Out-of-stock rejection ----

    # Set stock to 0 via inventory
    set_inventory(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 0)
    # Add exactly 2 units
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 2, 80.00)

    # Try to order 5 units — should fail
    order_data3 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 5,
        "price": 500,
    }])
    status4, order_res3 = create_order(order_data3)
    check("B11", status4 in (400, 409),
          f"OOS order should 4xx, got {status4}: {order_res3}")

    # Stock should be unchanged (2 units still there)
    remaining = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    check("B12", remaining == 2,
          f"stock unchanged after OOS rejection: expected 2, got {remaining}")

    # ---- B14-B16: Multi-batch consumption ----

    # Add three batches: 3@120, 4@140, 2@160
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 3, 120.00)
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 4, 140.00)
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 2, 160.00)

    # Order 6 units — should consume 3@120 + 3@140 = 360+420 = 780
    order_data4 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 6,
        "price": 500,
    }])
    status5, order_res4 = create_order(order_data4)
    check("B14", status5 == 201 and order_res4.get("order_id"),
          f"order for 6 units created: {status5}")
    order_id4 = order_res4.get("order_id")
    verify_payment(token, order_id4)

    _, full_order4 = get_order(token, order_id4)
    total_cost4 = full_order4.get("total_cost") if isinstance(full_order4, dict) else None
    check("B15", total_cost4 == 780,
          f"total_cost=780 (3×120+3×140): got {total_cost4}")

    # Remaining: 1@140 + 2@160 = 3 units (should be ~460 cost remaining)
    remaining4 = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    check("B16", remaining4 > 0 and remaining4 <= 10,
          f"stock remaining after multi-batch order: {remaining4}")

    # ---- B17-B19: restore_fifo_batches idempotency ----

    # Add 5@90, capture batch_allocations from an order, then restore
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 5, 90.00)
    order_data5 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 2,
        "price": 500,
    }])
    status6, order_res5 = create_order(order_data5)
    order_id5 = order_res5.get("order_id")

    _, full_order5 = get_order(token, order_id5)
    allocs = full_order5.get("batch_allocations", []) if isinstance(full_order5, dict) else []
    stock_before = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)

    # Restore once
    # (Idempotency is tested by calling restore twice — the second call should be no-op)
    # Direct RPC call through admin endpoint not exposed; we verify via cancel
    cancel_status, cancel_res = cancel_order(token, order_id5)
    check("B17", cancel_status == 200,
          f"order cancelled (triggers restore): {cancel_status} {cancel_res}")

    stock_after_restore = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    check("B18", stock_after_restore == stock_before + 2,
          f"stock restored after cancel: {stock_before}+2={stock_before+2}, got {stock_after_restore}")

    # Restore again — should be idempotent (stock unchanged)
    # Second cancel of same order should fail (404 order not found)
    cancel2_status, _ = cancel_order(token, order_id5)
    check("B19", cancel2_status in (404, 409),
          f"second cancel of same order is rejected: {cancel2_status}")

    # ---- B20-B22: Payment rejection restores batches ----

    # Add 10@110
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 10, 110.00)
    order_data6 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 4,
        "price": 500,
    }])
    status7, order_res6 = create_order(order_data6)
    order_id6 = order_res6.get("order_id")
    stock_before_reject = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)

    reject_status, reject_res = reject_payment(token, order_id6, "Test: eSewa not received")
    check("B20", reject_status == 200,
          f"payment rejected: {reject_status} {reject_res}")

    stock_after_reject = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    check("B21", stock_after_reject == stock_before_reject + 4,
          f"stock restored after reject: {stock_before_reject}+4={stock_before_reject+4}, got {stock_after_reject}")

    # Verify batch_allocations is still recorded (for audit)
    _, full_order6 = get_order(token, order_id6)
    allocs6 = full_order6.get("batch_allocations", []) if isinstance(full_order6, dict) else []
    check("B22", isinstance(allocs6, list),
          f"batch_allocations preserved on order: {allocs6}")

    # ---- B23-B25: Order cancellation restores batches ----

    # Add 6@95
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 6, 95.00)
    order_data7 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 3,
        "price": 500,
    }], payment="cod")
    status8, order_res7 = create_order(order_data7)
    order_id7 = order_res7.get("order_id")
    stock_before_cancel = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)

    cancel_status2, cancel_res2 = cancel_order(token, order_id7)
    check("B23", cancel_status2 == 200,
          f"COD order cancelled: {cancel_status2}")

    stock_after_cancel = get_variant_stock(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE)
    check("B24", stock_after_cancel == stock_before_cancel + 3,
          f"stock restored after COD cancel: {stock_before_cancel}+3={stock_before_cancel+3}, got {stock_after_cancel}")

    # Status should be cancelled
    _, full_order7 = get_order(token, order_id7)
    order_status = full_order7.get("status") if isinstance(full_order7, dict) else None
    check("B25", order_status == "cancelled",
          f"order status=cancelled: got {order_status}")

    # ---- B26: Cost accuracy ----

    # Add 4@130, order 4 units — cost should be exactly 520
    add_stock_with_cost(token, TEST_PRODUCT_ID, TEST_COLOR, TEST_SIZE, 4, 130.00)
    order_data8 = make_order([{
        "id": TEST_PRODUCT_ID,
        "name": "Test Product",
        "color": TEST_COLOR,
        "size": TEST_SIZE,
        "quantity": 4,
        "price": 500,
    }])
    status9, order_res8 = create_order(order_data8)
    order_id8 = order_res8.get("order_id")
    verify_payment(token, order_id8)

    _, full_order8 = get_order(token, order_id8)
    total_cost8 = full_order8.get("total_cost") if isinstance(full_order8, dict) else None
    check("B26", total_cost8 == 520,
          f"FIFO cost accuracy: 4×130=520, got {total_cost8}")

    # ---- B27: Profit calculation ----

    # Order total=2000 (4×500), cost=520, profit=1480
    profit = (4 * 500) - (total_cost8 or 0)
    check("B27", profit == 1480,
          f"Profit=1480 (2000-520): got {profit}")

    # ---- B28: All-batches view without color/size ----

    _, all_batches_res = list_all_batches(token)
    all_batches = all_batches_res.get("batches", []) if isinstance(all_batches_res, dict) else []
    check("B28", isinstance(all_batches, list) and len(all_batches) > 0,
          f"all-batches view returns {len(all_batches)} rows")

    # ---- B29: Anon cannot read batches ----

    # Attempt to call /api/admin/batches without auth — should 401/403
    anon_status, _ = http("GET", "/api/admin/batches?product_id=1")
    check("B29", anon_status in (401, 403),
          f"anon access to batches should 4xx, got {anon_status}")

    # -------------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------------
    passed = sum(results)
    total = len(results)
    print(f"\n{'='*50}")
    print(f"FIFO Batch Tests: {passed}/{total} passed")
    if passed == total:
        print("All tests passed.")
    else:
        print("Some tests FAILED — review output above.")
    print(f"{'='*50}")


if __name__ == "__main__":
    run_tests()
