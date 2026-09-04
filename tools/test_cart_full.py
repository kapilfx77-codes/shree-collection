"""
Comprehensive cart/checkout verification with screenshots and console monitoring.
Covers all flows + edge cases requested in the task.
"""
import asyncio
import json
import sys
from playwright.async_api import async_playwright

BASE = "http://localhost:8765"


async def wait_supabase(page, timeout=15000):
    try:
        await page.wait_for_function(
            "() => typeof supabaseClient !== 'undefined' && supabaseClient !== null",
            timeout=timeout,
        )
    except Exception:
        pass
    await page.wait_for_timeout(1500)


def result_table(results):
    lines = ["=" * 70, "VERIFICATION MATRIX", "=" * 70]
    keys = list(results.keys())
    for k in keys:
        v = results[k]
        status = "PASS" if v.get("ok") else "FAIL"
        lines.append(f"[{status}] {k}: {v.get('detail','')}")
    return "\n".join(lines)


async def main():
    results = {}
    console_errors = []
    console_warnings = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Set default timeouts to be snappier
        browser_context_timeout = 15000

        # ============ DESKTOP RUN ============
        ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await ctx.new_page()
        page.set_default_timeout(8000)

        def on_console(msg):
            if msg.type == "error":
                console_errors.append(f"[error] {msg.text}")
            elif msg.type == "warning":
                console_warnings.append(f"[warning] {msg.text}")

        def on_pageerror(err):
            console_errors.append(f"[pageerror] {err}")

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)

        # Clear any prior state
        await page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        await page.evaluate("() => localStorage.removeItem('shree_collection_cart')")

        # ---- FLOW 1: Catalog cart icon ----
        await page.goto(f"{BASE}/catalog.html", wait_until="domcontentloaded")
        await wait_supabase(page)

        # Verify drawer initially closed
        initial_open = await page.evaluate(
            "() => document.getElementById('cartDrawer')?.classList.contains('open')"
        )
        cart_btn_exists = await page.query_selector("#cartBtn") is not None
        drawer_exists = await page.query_selector("#cartDrawer") is not None
        overlay_exists = await page.query_selector("#cartOverlay") is not None

        # Click cart icon
        await page.click("#cartBtn", force=True)
        await page.wait_for_timeout(500)
        after_open = await page.evaluate(
            "() => document.getElementById('cartDrawer')?.classList.contains('open')"
        )
        overlay_open = await page.evaluate(
            "() => document.getElementById('cartOverlay')?.classList.contains('open')"
        )
        await page.screenshot(path="tools/v_catalog_drawer_empty.png", timeout=5000)

        # Close drawer
        await page.click("#closeCartDrawer", force=True)
        await page.wait_for_timeout(400)
        closed = not await page.evaluate(
            "() => document.getElementById('cartDrawer')?.classList.contains('open')"
        )

        results["F1_catalog_drawer_opens"] = {
            "ok": after_open and overlay_open and drawer_exists and overlay_exists and cart_btn_exists and closed,
            "detail": f"drawer={drawer_exists} overlay={overlay_exists} btn={cart_btn_exists} open={after_open} overlay_open={overlay_open} closes={closed}",
        }

        # ---- FLOW 2: Product page add to cart -> drawer opens with item ----
        # Get first product URL
        await page.goto(f"{BASE}/catalog.html", wait_until="domcontentloaded")
        await wait_supabase(page)
        first_product = await page.evaluate("""
            () => {
                const card = document.querySelector('.product-card a[href*="product.html"]');
                if (!card) return null;
                const href = card.getAttribute('href') || '';
                const m = href.match(/[?&]id=(\\d+)/);
                return m ? m[1] : '1';
            }
        """)
        first_product_url = f"{BASE}/product.html?id={first_product or '1'}"
        await page.goto(first_product_url, wait_until="domcontentloaded")
        await wait_supabase(page, timeout=20000)
        await page.wait_for_timeout(800)

        # Programmatically add to cart
        add_result = await page.evaluate("""
            async () => {
                try {
                    await addToCart(1, 'M', 'Red', 1);
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: String(e) };
                }
            }
        """)
        await page.wait_for_timeout(800)

        # Drawer should be open
        drawer_open = await page.evaluate(
            "() => document.getElementById('cartDrawer')?.classList.contains('open')"
        )
        # Cart should have item
        cart_data = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')"
        )
        await page.screenshot(path="tools/v_product_drawer_with_item.png", timeout=5000)

        results["F2_product_add_opens_drawer"] = {
            "ok": drawer_open and len(cart_data) >= 1 and add_result.get("ok"),
            "detail": f"add_ok={add_result.get('ok')} drawer_open={drawer_open} items={len(cart_data)}",
        }

        # Verify cart footer (Subtotal + buttons) is visible
        footer_state = await page.evaluate("""
            () => {
                const f = document.getElementById('cartHasItemsFooter');
                if (!f) return { exists: false };
                const cs = window.getComputedStyle(f);
                return { exists: true, display: cs.display, offsetHeight: f.offsetHeight };
            }
        """)
        results["F2b_cart_footer_visible"] = {
            "ok": footer_state.get("exists") and footer_state.get("display") != "none" and footer_state.get("offsetHeight", 0) > 0,
            "detail": f"footer={footer_state}",
        }

        # Verify Proceed to Checkout button visible
        checkout_visible = await page.is_visible("#checkoutBtn")
        checkout_enabled = await page.is_enabled("#checkoutBtn")
        results["F2c_checkout_button_visible"] = {
            "ok": checkout_visible and checkout_enabled,
            "detail": f"visible={checkout_visible} enabled={checkout_enabled}",
        }

        # ---- FLOW 3: Proceed to Checkout ----
        try:
            async with page.expect_navigation(timeout=10000):
                await page.click("#checkoutBtn", force=True)
            nav_ok = "checkout.html" in page.url
        except Exception as e:
            nav_ok = False
        await page.wait_for_timeout(800)
        await page.screenshot(path="tools/v_checkout_page.png", timeout=5000)

        # Verify checkout form exists
        checkout_form_ok = await page.evaluate("""
            () => {
                const form = document.querySelector('form, .checkout-form, [data-checkout]')
                    || document.querySelector('input[name*="name" i], input[placeholder*="name" i]');
                return !!form;
            }
        """)
        order_summary_ok = await page.evaluate("""
            () => {
                const text = document.body.innerText || '';
                return text.includes('Order Summary') || text.includes('Subtotal') || text.includes('Total');
            }
        """)
        results["F3_checkout_navigates"] = {
            "ok": nav_ok and checkout_form_ok and order_summary_ok,
            "detail": f"navigated={nav_ok} form={checkout_form_ok} summary={order_summary_ok} url={page.url}",
        }

        # ---- FLOW 4: Cart state persistence across navigation ----
        # Add 2 items, navigate around, verify cart still has them
        await page.goto(f"{BASE}/catalog.html", wait_until="domcontentloaded")
        await wait_supabase(page)
        await page.evaluate("() => localStorage.removeItem('shree_collection_cart')")
        await page.evaluate("async () => { await addToCart(1, 'M', 'Red', 2); }")
        await page.wait_for_timeout(300)
        await page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        await wait_supabase(page)
        await page.wait_for_timeout(500)
        cart_after_nav = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')"
        )
        await page.click("#cartBtn", force=True)
        await page.wait_for_timeout(500)
        drawer_open_after_nav = await page.evaluate(
            "() => document.getElementById('cartDrawer')?.classList.contains('open')"
        )
        await page.screenshot(path="tools/v_persistence.png", timeout=5000)

        results["F4_cart_persists_across_nav"] = {
            "ok": len(cart_after_nav) >= 1 and drawer_open_after_nav,
            "detail": f"items_after_nav={len(cart_after_nav)} drawer_opens={drawer_open_after_nav}",
        }

        # ---- FLOW 5: Cart quantity controls (increase, decrease, remove) ----
        # Add a fresh item
        await page.evaluate("() => localStorage.removeItem('shree_collection_cart')")
        await page.evaluate("async () => { await addToCart(1, 'M', 'Red', 1); }")
        await page.wait_for_timeout(300)

        # Open drawer
        await page.evaluate("() => openCartDrawer()")
        await page.wait_for_timeout(400)

        # Increase qty
        before_qty = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart'))[0].quantity"
        )
        await page.evaluate("() => updateQuantity(0, 1)")
        await page.wait_for_timeout(300)
        after_increase = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart'))[0].quantity"
        )

        # Decrease qty
        await page.evaluate("() => updateQuantity(0, -1)")
        await page.wait_for_timeout(300)
        after_decrease = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart'))[0].quantity"
        )

        # Remove item
        await page.evaluate("() => removeFromCart(0)")
        await page.wait_for_timeout(300)
        after_remove = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')"
        )
        empty_state_visible = await page.is_visible("#cartEmptyState")

        results["F5_qty_controls_work"] = {
            "ok": (after_increase == before_qty + 1) and (after_decrease == before_qty) and (len(after_remove) == 0) and empty_state_visible,
            "detail": f"before={before_qty} +1={after_increase} -1={after_decrease} removed={len(after_remove)==0} empty_state={empty_state_visible}",
        }

        # ---- FLOW 6: Refresh persistence ----
        await page.evaluate("async () => { await addToCart(1, 'M', 'Red', 3); }")
        await page.wait_for_timeout(300)
        before_refresh = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')"
        )
        await page.reload(wait_until="domcontentloaded")
        await wait_supabase(page)
        await page.wait_for_timeout(800)
        after_refresh = await page.evaluate(
            "() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')"
        )

        results["F6_refresh_persistence"] = {
            "ok": len(after_refresh) == len(before_refresh)
            and (len(after_refresh) == 0 or after_refresh[0].get("quantity") == 3),
            "detail": f"before_count={len(before_refresh)} after_count={len(after_refresh)} qty={after_refresh[0].get('quantity') if after_refresh else 'n/a'}",
        }

        # ---- FLOW 7: Empty cart warning ----
        await page.evaluate("() => localStorage.removeItem('shree_collection_cart')")
        await page.evaluate("() => closeCartDrawer()")
        await page.wait_for_timeout(300)
        await page.click("#cartBtn", force=True)
        await page.wait_for_timeout(400)

        # If user clicks checkout on empty cart, expect toast/warning
        # But checkout button only shows when items exist, so simulate the path
        # We can call proceedToCheckout directly on empty
        empty_nav_attempt = await page.evaluate("""
            () => {
                let navigated = false;
                const orig = window.location.href;
                try { proceedToCheckout(); } catch (e) {}
                return { same_url: window.location.href === orig, url: window.location.href };
            }
        """)
        results["F7_empty_cart_does_not_navigate"] = {
            "ok": empty_nav_attempt.get("same_url", True),
            "detail": f"empty={empty_nav_attempt}",
        }

        # Close drawer so screenshot is fast
        try:
            await page.evaluate("() => closeCartDrawer()")
        except Exception:
            pass

        try:
            await page.screenshot(path="tools/v_empty_cart.png", timeout=5000)
        except Exception as e:
            print(f"[warn] empty cart screenshot: {e}")

        await ctx.close()

        # ============ MOBILE RUN ============
        mctx = await browser.new_context(viewport={"width": 390, "height": 844})
        mpage = await mctx.new_page()
        mpage.set_default_timeout(8000)
        mpage.on("console", on_console)
        mpage.on("pageerror", on_pageerror)

        await mpage.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        await wait_supabase(mpage)
        await mpage.evaluate("() => localStorage.removeItem('shree_collection_cart')")
        await mpage.evaluate("async () => { await addToCart(1, 'M', 'Red', 1); }")
        await mpage.wait_for_timeout(500)
        try:
            await mpage.screenshot(path="tools/v_mobile_drawer.png", timeout=5000)
        except Exception as e:
            print(f"[warn] mobile screenshot: {e}")
        mobile_drawer_open = await mpage.evaluate(
            "() => document.getElementById('cartDrawer')?.classList.contains('open')"
        )
        results["M1_mobile_drawer_renders"] = {
            "ok": mobile_drawer_open,
            "detail": f"drawer_open={mobile_drawer_open}",
        }

        await mctx.close()
        await browser.close()

    print(result_table(results))
    print()
    print("=" * 70)
    print("CONSOLE ERRORS")
    print("=" * 70)
    if console_errors:
        for e in console_errors:
            print(e)
    else:
        print("(none)")
    print()
    print(f"Console warnings: {len(console_warnings)} (informational only)")
    for w in console_warnings[:5]:
        print("  " + w)

    # Exit non-zero on any failure
    failed = [k for k, v in results.items() if not v.get("ok")]
    if failed:
        print()
        print("FAILED TESTS:", failed)
        sys.exit(1)
    else:
        print()
        print("ALL TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
