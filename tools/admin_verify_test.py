"""End-to-end test of the admin Verify Payment / Reject Payment flow.

Sequence:
  1. Login as admin → bearer token
  2. Create a fresh eSewa order via /api/orders (server total, payment_status=pending)
  3. Customer cannot call /api/admin/orders/verify (expect 401)
  4. Admin calls /api/admin/orders/verify on the fresh order → 200, status=paid
  5. Verify all audit fields populated
  6. Second verify on the same order → 409 (already paid)
  7. Create another eSewa order, reject it → 200, status=failed, audit populated
  8. Bad reason (< 4 chars) → 400
  9. Verify on a non-esewa order (COD) → 409
"""
import json
import random
import string
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _test_env import resolve_base_url  # noqa: E402

BASE = resolve_base_url()
PASSWORD = "Kapil@Ef2618F"


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
            if expect_json and txt:
                try:
                    return r.status, json.loads(txt)
                except Exception:
                    return r.status, txt
            return r.status, txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", errors="replace")
        if expect_json and txt:
            try:
                return e.code, json.loads(txt)
            except Exception:
                return e.code, txt
        return e.code, txt


def phone():
    return "98" + "".join(random.choices(string.digits, k=8))


def make_order(payment="esewa", item_id=1):
    return {
        "name": "AdminVerifyTest",
        "phone": phone(),
        "city": "Butwal",
        "address": "Ward 1",
        "items": [{"id": item_id, "size": "M", "color": "Red", "quantity": 1}],
        "paymentMethod": payment,
    }


def make_cod_order():
    return make_order(payment="cod")


def main() -> int:
    results = []

    # --- 1. Admin login ---
    s, body = http("POST", "/api/login", {"password": PASSWORD})
    if s != 200:
        print(f"FATAL: login failed: {s} {body}")
        return 1
    token = body["token"]
    admin_h = {"Authorization": f"Bearer {token}"}
    print(f"[setup] admin token issued ({len(token)} chars)")

    # --- 1b. Seed variant stock so the order lines don't fail on OOS ---
    # The test creates orders with item_id=1, size="M", color="Red".
    # The variant inventory table now tracks stock per (product, color, size).
    seed_status, seed = http(
        "POST",
        "/api/admin/inventory",
        {"product_id": 1, "color": "Red", "size": "M", "quantity": 100},
        headers=admin_h,
    )
    if seed_status in (200, 201):
        print(f"[setup] seeded inventory: product=1 Red/M qty=100 (HTTP {seed_status})")
    else:
        print(f"[setup] WARNING: could not seed inventory: HTTP {seed_status} body={seed!r}")

    # --- 2. Create a fresh eSewa order ---
    s, body = http("POST", "/api/orders", make_order("esewa"))
    assert s == 201, f"setup eSewa order failed: {s} {body}"
    esewa_order_id = body["order_id"]
    print(f"[setup] eSewa order: {esewa_order_id} total={body.get('total')} payment_status={body.get('payment_status')}")
    results.append(("01_setup_esewa_order_pending", body.get("payment_status") == "pending",
                    f"order_id={esewa_order_id} status={body.get('payment_status')}"))

    # --- 3. Customer cannot call /api/admin/orders/verify ---
    s, body = http("POST", "/api/admin/orders/verify",
                   {"order_id": esewa_order_id, "source": "manual_admin"})
    results.append(("02_anonymous_verify_rejected", s == 401,
                    f"HTTP {s}: {body.get('error') if isinstance(body, dict) else body}"))

    # --- 4. Admin verifies the eSewa order ---
    s, body = http("POST", "/api/admin/orders/verify",
                   {"order_id": esewa_order_id, "source": "manual_admin"},
                   headers=admin_h)
    verify_ok = (s == 200 and body.get("ok") and
                 body.get("order", {}).get("payment_status") == "paid")
    order_after = body.get("order", {}) if isinstance(body, dict) else {}
    results.append(("03_admin_verify_esewa_paid", verify_ok,
                    f"HTTP {s} status={order_after.get('payment_status')} "
                    f"verified_at={'set' if order_after.get('payment_verified_at') else 'MISSING'} "
                    f"verified_by={order_after.get('payment_verified_by')} "
                    f"source={order_after.get('payment_verification_source')}"))

    # --- 5. All audit fields populated ---
    audit_ok = (
        bool(order_after.get("payment_verified_at"))
        and order_after.get("payment_verified_by") == "admin"
        and order_after.get("payment_verification_source") == "manual_admin"
    )
    results.append(("04_verify_audit_fields_populated", audit_ok,
                    f"at={order_after.get('payment_verified_at')} "
                    f"by={order_after.get('payment_verified_by')} "
                    f"src={order_after.get('payment_verification_source')}"))

    # --- 6. Second verify on already-paid order ---
    s, body = http("POST", "/api/admin/orders/verify",
                   {"order_id": esewa_order_id, "source": "manual_admin"},
                   headers=admin_h)
    results.append(("05_second_verify_409", s == 409,
                    f"HTTP {s}: {body.get('error') if isinstance(body, dict) else body}"))

    # --- 7. Reject flow: create another eSewa order, then reject it ---
    s, body = http("POST", "/api/orders", make_order("esewa"))
    assert s == 201, f"setup reject order failed: {s} {body}"
    reject_order_id = body["order_id"]
    print(f"[setup] reject-target eSewa order: {reject_order_id}")

    s, body = http("POST", "/api/admin/orders/reject",
                   {"order_id": reject_order_id, "reason": "Customer did not pay"},
                   headers=admin_h)
    reject_ok = (s == 200 and body.get("ok") and
                 body.get("order", {}).get("payment_status") == "failed")
    rej_after = body.get("order", {}) if isinstance(body, dict) else {}
    results.append(("06_admin_reject_esewa_failed", reject_ok,
                    f"HTTP {s} status={rej_after.get('payment_status')} "
                    f"rejected_at={'set' if rej_after.get('payment_rejected_at') else 'MISSING'} "
                    f"rejected_by={rej_after.get('payment_rejected_by')} "
                    f"reason={rej_after.get('payment_rejection_reason')}"))

    audit_ok = (
        bool(rej_after.get("payment_rejected_at"))
        and rej_after.get("payment_rejected_by") == "admin"
        and rej_after.get("payment_rejection_reason") == "Customer did not pay"
    )
    results.append(("07_reject_audit_fields_populated", audit_ok,
                    f"at={rej_after.get('payment_rejected_at')} "
                    f"by={rej_after.get('payment_rejected_by')} "
                    f"reason={rej_after.get('payment_rejection_reason')}"))

    # --- 8. Bad reason ---
    s, body = http("POST", "/api/admin/orders/verify",
                   {"order_id": "SHREE-DOES-NOT-MATTER", "source": "manual_admin"},
                   headers=admin_h)
    # verify needs a valid eSewa pending order, but here we test reason length
    # which only applies to reject. Create fresh, reject with short reason.
    s2, body2 = http("POST", "/api/orders", make_order("esewa"))
    if s2 == 201:
        target = body2["order_id"]
        s, body = http("POST", "/api/admin/orders/reject",
                       {"order_id": target, "reason": "no"},
                       headers=admin_h)
        results.append(("08_reject_short_reason_400", s == 400,
                        f"HTTP {s}: {body.get('error') if isinstance(body, dict) else body}"))
    else:
        results.append(("08_reject_short_reason_400", False, "setup failed"))

    # --- 9. Verify on a COD order → 409 ---
    s, body = http("POST", "/api/orders", make_cod_order())
    assert s == 201, f"setup COD order failed: {s} {body}"
    cod_order_id = body["order_id"]
    print(f"[setup] COD order: {cod_order_id}")
    s, body = http("POST", "/api/admin/orders/verify",
                   {"order_id": cod_order_id, "source": "manual_admin"},
                   headers=admin_h)
    results.append(("09_verify_cod_409", s == 409,
                    f"HTTP {s}: {body.get('error') if isinstance(body, dict) else body}"))

    # --- 10. Verify a non-existent order → 404 ---
    s, body = http("POST", "/api/admin/orders/verify",
                   {"order_id": "SHREE-NONEXISTENT-XXXX", "source": "manual_admin"},
                   headers=admin_h)
    results.append(("10_verify_missing_404", s == 404,
                    f"HTTP {s}: {body.get('error') if isinstance(body, dict) else body}"))

    # --- Print results ---
    print("\n============================================================")
    print("ADMIN VERIFY/REJECT PRODUCTION TEST")
    print("============================================================")
    passed = 0
    for name, ok, detail in results:
        tag = "PASS" if ok else "FAIL"
        print(f"[{tag}] {name}: {detail}")
        if ok:
            passed += 1
    print(f"\nTotal: {passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
