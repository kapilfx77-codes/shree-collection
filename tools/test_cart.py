"""
Comprehensive runtime test for the cart/checkout flow.
Reproduces all 3 user flows: catalog, product, checkout.
"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8765"


async def wait_for_supabase(page, timeout=15000):
    """Wait for Supabase to be ready and products to load."""
    try:
        await page.wait_for_function(
            "() => typeof supabaseClient !== 'undefined' && supabaseClient !== null",
            timeout=timeout
        )
    except Exception:
        pass
    await page.wait_for_timeout(2000)  # let products load


async def get_console_logs(page):
    """Capture all console logs."""
    return []


async def test_catalog_flow(page, logs):
    """FLOW 1: catalog.html - click cart icon -> drawer opens"""
    print("\n" + "=" * 60)
    print("FLOW 1: CATALOG - cart icon click")
    print("=" * 60)
    await page.goto(f"{BASE}/catalog.html", wait_until="domcontentloaded")
    await wait_for_supabase(page)

    # Verify cart drawer exists in DOM
    drawer = await page.query_selector('#cartDrawer')
    overlay = await page.query_selector('#cartOverlay')
    cart_btn = await page.query_selector('#cartBtn')
    print(f"#cartDrawer in DOM: {drawer is not None}")
    print(f"#cartOverlay in DOM: {overlay is not None}")
    print(f"#cartBtn in DOM: {cart_btn is not None}")

    # Verify drawer is initially closed
    initially_open = await page.evaluate(
        "() => document.getElementById('cartDrawer')?.classList.contains('open')"
    )
    print(f"Drawer initially open: {initially_open}")

    # Click the cart icon
    if cart_btn:
        await cart_btn.click()
        await page.wait_for_timeout(500)

    # Check if drawer is now open
    is_open = await page.evaluate(
        "() => document.getElementById('cartDrawer')?.classList.contains('open')"
    )
    overlay_open = await page.evaluate(
        "() => document.getElementById('cartOverlay')?.classList.contains('open')"
    )
    print(f"After click, drawer.open: {is_open}")
    print(f"After click, overlay.open: {overlay_open}")

    # Take a screenshot to verify visual
    await page.screenshot(path='tools/catalog_cart_after_click.png')
    print("Screenshot: tools/catalog_cart_after_click.png")

    return is_open


async def test_product_flow(page, logs):
    """FLOW 2: product.html - add to cart -> drawer opens"""
    print("\n" + "=" * 60)
    print("FLOW 2: PRODUCT - add to cart")
    print("=" * 60)

    # First get a product from the catalog
    await page.goto(f"{BASE}/catalog.html", wait_until="domcontentloaded")
    await wait_for_supabase(page)

    # Get first product URL
    first_product = await page.evaluate("""
        () => {
            const card = document.querySelector('.product-card a[href*="product.html"]');
            return card ? card.href : null;
        }
    """)
    print(f"First product URL: {first_product}")

    if not first_product:
        print("No products found in catalog!")
        return False

    await page.goto(first_product, wait_until="domcontentloaded")
    await wait_for_supabase(page, timeout=20000)
    await page.wait_for_timeout(1000)

    # Check for View Cart button
    view_cart_btn = await page.query_selector('[onclick*="openCartDrawer"]')
    print(f"Has 'View Cart' button (onclick=openCartDrawer): {view_cart_btn is not None}")

    # Check for Add to Cart button
    add_btn = await page.query_selector('[onclick*="addCurrentProductToCart"]')
    print(f"Has 'Add to Cart' button: {add_btn is not None}")

    # Click add to cart
    if add_btn:
        await add_btn.click()
        await page.wait_for_timeout(2000)

    # Check if drawer is open
    is_open = await page.evaluate(
        "() => document.getElementById('cartDrawer')?.classList.contains('open')"
    )
    print(f"After Add to Cart, drawer.open: {is_open}")

    # Check cart contents
    cart_data = await page.evaluate("() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')")
    print(f"Cart contents: {cart_data}")

    # Look for any "View Cart" button
    all_buttons = await page.evaluate("""
        () => {
            const btns = document.querySelectorAll('button, a.btn, [onclick]');
            return Array.from(btns).map(b => ({
                text: (b.textContent || '').trim().slice(0, 40),
                onclick: b.getAttribute('onclick') || ''
            })).filter(b => b.onclick.includes('openCart') || b.text.toLowerCase().includes('view cart'));
        }
    """)
    print(f"View Cart-like buttons found: {all_buttons}")

    await page.screenshot(path='tools/product_after_add.png')
    print("Screenshot: tools/product_after_add.png")

    return is_open


async def test_checkout_flow(page, logs):
    """FLOW 3: Proceed to Checkout"""
    print("\n" + "=" * 60)
    print("FLOW 3: CHECKOUT - Proceed to Checkout")
    print("=" * 60)

    # First add a product to cart
    await page.goto(f"{BASE}/catalog.html", wait_until="domcontentloaded")
    await wait_for_supabase(page)

    # Add first product
    add_result = await page.evaluate("""
        async () => {
            try {
                await addToCart(1, 'M', 'Red', 1);
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }
    """)
    print(f"addToCart result: {add_result}")
    await page.wait_for_timeout(500)

    # Check cart contents
    cart = await page.evaluate("() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]')")
    print(f"Cart contents: {cart}")

    # Open cart drawer
    await page.evaluate("() => openCartDrawer()")
    await page.wait_for_timeout(500)

    # Verify Proceed to Checkout button is visible
    checkout_btn = await page.query_selector('#checkoutBtn')
    print(f"#checkoutBtn in DOM: {checkout_btn is not None}")

    if checkout_btn:
        is_visible = await page.is_visible('#checkoutBtn')
        is_enabled = await page.is_enabled('#checkoutBtn')
        print(f"Checkout button visible: {is_visible}, enabled: {is_enabled}")

    # Check the cart footer is visible
    footer_visible = await page.evaluate("""
        () => {
            const f = document.getElementById('cartHasItemsFooter');
            if (!f) return null;
            return {
                display: window.getComputedStyle(f).display,
                visibility: window.getComputedStyle(f).visibility,
                offsetHeight: f.offsetHeight
            };
        }
    """)
    print(f"Cart footer state: {footer_visible}")

    # Check the cartHasItems
    cart_has_items = await page.evaluate("""
        () => {
            const c = document.getElementById('cartHasItems');
            if (!c) return null;
            return {
                display: window.getComputedStyle(c).display,
                visibility: window.getComputedStyle(c).visibility,
                offsetHeight: c.offsetHeight
            };
        }
    """)
    print(f"Cart has items state: {cart_has_items}")

    # Try to click checkout
    if checkout_btn:
        try:
            # Listen for navigation
            async with page.expect_navigation(timeout=5000) as nav_info:
                await checkout_btn.click()
            print(f"Navigation to: {nav_info.value.url if hasattr(nav_info, 'value') else 'navigated'}")
        except Exception as e:
            print(f"Navigation error: {e}")
            # Check current URL
            current = page.url
            print(f"Current URL: {current}")

    await page.wait_for_timeout(1000)
    print(f"Final URL: {page.url}")

    await page.screenshot(path='tools/checkout_test.png')
    print("Screenshot: tools/checkout_test.png")

    return 'checkout.html' in page.url


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        # Capture console logs and errors
        logs = []
        page.on('console', lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        page.on('pageerror', lambda err: logs.append(f"[pageerror] {err}"))

        results = {}
        results['catalog'] = await test_catalog_flow(page, logs)
        results['product'] = await test_product_flow(page, logs)
        results['checkout'] = await test_checkout_flow(page, logs)

        print("\n" + "=" * 60)
        print("CONSOLE LOGS / ERRORS")
        print("=" * 60)
        for log in logs[-50:]:  # last 50
            print(log)

        print("\n" + "=" * 60)
        print("RESULTS")
        print("=" * 60)
        print(f"Catalog cart open: {results['catalog']}")
        print(f"Product cart open: {results['product']}")
        print(f"Checkout navigation: {results['checkout']}")

        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
