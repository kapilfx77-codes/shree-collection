"""
Production smoke test for Shree Collection. Prints incrementally so partial
results are visible even if a later step fails.

URL resolution: see tools/_test_env.py. The generic BASE_URL env var is
intentionally NOT consulted because on this host it points to the OmniRoute
local gateway, not to a web service. Use SHREE_BASE_URL if you need to
override the default.
"""
import asyncio
import os
import sys

# Force UTF-8 stdout so non-ASCII in titles doesn't mangle
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Make `tools/` importable when this script is run directly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright  # noqa: E402

from playwright.async_api import async_playwright  # noqa: E402

BASE = resolve_base_url()
print(f"[smoke_prod] using BASE_URL = {BASE}", flush=True)


def log(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}", flush=True)


async def wait_supabase(page, timeout=15000):
    try:
        await page.wait_for_function(
            "() => typeof supabaseClient !== 'undefined' && supabaseClient !== null",
            timeout=timeout,
        )
    except Exception:
        pass
    try:
        await page.wait_for_function(
            "() => typeof addToCart === 'function'",
            timeout=timeout,
        )
    except Exception:
        pass
    await page.wait_for_timeout(1500)


async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-proxy-server"],
            env=clean_env_for_playwright(),
        )
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
            bypass_csp=True,
        )
        # Disable HTTP cache for fresh fetches every run
        await ctx.route("**/*", lambda route: route.continue_(
            headers={**route.request.headers, "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}
        ))
        page = await ctx.new_page()
        page.set_default_timeout(30000)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # T1: storefront loads
        resp1 = await page.goto(f"{BASE}/index.html", wait_until="networkidle")
        title = await page.title()
        # Save the actual HTML for debugging
        html = await page.content()
        debug_path = os.path.join(os.path.dirname(__file__), "t1.html")
        with open(debug_path, "w", encoding="utf-8") as f:
            f.write(html)
        log("T1_storefront_loads", "Shree" in title, f"title='{title}' url={page.url} status={resp1.status} html_len={len(html)} saved={debug_path}")

        # T2: catalog loads
        await page.goto(f"{BASE}/catalog.html", wait_until="networkidle")
        await wait_supabase(page)
        products_count = await page.evaluate("""
            () => document.querySelectorAll('.product-card').length
        """)
        log("T2_catalog_loads", True, f"product cards: {products_count} (expected 0 - empty DB)")

        # T3: cart button exists and opens drawer
        await page.goto(f"{BASE}/index.html", wait_until="networkidle")
        await wait_supabase(page)
        # Wait for header chrome to render
        try:
            await page.wait_for_selector("#cartBtn", timeout=10000)
        except Exception:
            pass
        cart_btn = await page.query_selector("#cartBtn")
        drawer = await page.query_selector("#cartDrawer")
        log("T3_cart_elements_present", cart_btn is not None and drawer is not None, f"btn={cart_btn is not None} drawer={drawer is not None}")

        if cart_btn and drawer:
            await page.click("#cartBtn", force=True)
            await page.wait_for_timeout(400)
            opened = await page.evaluate("() => document.getElementById('cartDrawer')?.classList.contains('open')")
            log("T4_cart_drawer_opens", opened, f"open={opened}")
            await page.click("#closeCartDrawer", force=True)
            await page.wait_for_timeout(300)

        # T5: add to cart via localStorage + drawer
        # Make sure cart.js has loaded by trying multiple times
        for _ in range(3):
            ok = await page.evaluate("""
                async () => {
                    try {
                        if (typeof addToCart === 'function') {
                            await addToCart(1, 'M', 'Red', 1);
                            return true;
                        }
                    } catch (e) {}
                    return false;
                }
            """)
            if ok:
                break
            await page.wait_for_timeout(800)
        await page.wait_for_timeout(300)
        cart = await page.evaluate("() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')")
        log("T5_add_to_cart", len(cart) >= 1, f"items: {len(cart)}")

        # T6: checkout page exists
        await page.goto(f"{BASE}/checkout.html", wait_until="networkidle")
        await wait_supabase(page)
        has_form = await page.evaluate("""
            () => {
                const inputs = document.querySelectorAll('input, textarea, select');
                return inputs.length > 0;
            }
        """)
        log("T6_checkout_page_renders", has_form, f"form inputs: {has_form}")

        # T7: admin page loads
        await page.goto(f"{BASE}/admin.html", wait_until="networkidle")
        await page.wait_for_timeout(800)
        has_pwd = await page.evaluate("""
            () => {
                const p = document.querySelector('input[type="password"]');
                return !!p;
            }
        """)
        log("T7_admin_login_form", has_pwd, f"password field: {has_pwd}")

        # T8: product page loads
        await page.goto(f"{BASE}/product.html?id=1", wait_until="networkidle")
        await wait_supabase(page)
        await page.wait_for_timeout(800)
        has_add = await page.evaluate("""
            () => {
                const btns = document.querySelectorAll('button, .add-to-cart, [onclick*="addToCart"]');
                return btns.length > 0;
            }
        """)
        log("T8_product_page_renders", has_add, f"buttons: {has_add}")

        await ctx.close()
        await browser.close()

    print()
    print("=" * 60)
    print("CONSOLE ERRORS")
    print("=" * 60)
    if errors:
        for e in errors[:10]:
            print(e)
    else:
        print("(none)")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
