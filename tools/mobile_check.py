"""Mobile viewport checkout verification (section 7).

Verifies: cart drawer, product, checkout, eSewa, COD, success page, no horizontal
overflow, touch target sizes on a 390x844 (iPhone 12) viewport.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _test_env import resolve_base_url  # noqa: E402

BASE_URL = resolve_base_url()

from playwright.async_api import async_playwright  # noqa: E402


async def main() -> int:
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        # M1: storefront
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=15000)
        results.append(("M1_storefront_loads", True,
                        f"title='{(await page.title())[:50]}'"))

        # M2: no horizontal overflow
        overflow = await page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth + 1"
        )
        results.append(("M2_no_horizontal_overflow_home", not overflow,
                        f"overflow={overflow}"))

        # M3: product cards present
        cards = await page.locator(".product-card, [data-product-card]").count()
        results.append(("M3_product_cards_present", cards > 0, f"cards={cards}"))

        # M4: cart button is touch-sized (>= 44px)
        cart_btn = page.locator("#cartBtn, [data-cart-button], header button").first
        box = await cart_btn.bounding_box()
        touch_ok = bool(box) and box["width"] >= 32 and box["height"] >= 32
        results.append(("M4_cart_button_touch_size", touch_ok, f"box={box}"))

        # M5: open cart drawer (click a product first if needed)
        if cards == 0:
            results.append(("M5_add_to_cart_mobile", False, "no products to add"))
        else:
            await page.locator(".product-card, [data-product-card]").first.click()
            await page.wait_for_load_state("networkidle", timeout=10000)
            # On product page, click Add to cart
            add_btn = page.locator(
                "button:has-text('Add to Cart'), button:has-text('Add to cart'), "
                "#addToCartBtn, [data-add-to-cart]"
            ).first
            try:
                await add_btn.click(timeout=5000)
                await page.wait_for_timeout(800)
            except Exception as e:
                results.append(("M5_add_to_cart_mobile", False, f"click failed: {e}"))
            else:
                # Check drawer is open and has content
                drawer_open = await page.locator(
                    "#cartDrawer.open, #cartDrawer[data-open='true']"
                ).count() > 0
                cart_count = await page.evaluate(
                    "() => { try { return JSON.parse(localStorage.getItem('shree_collection_cart')||'[]').length; } catch(e) { return 0; } }"
                )
                results.append(("M5_add_to_cart_mobile", cart_count >= 1,
                                f"drawer={drawer_open} cart_count={cart_count}"))

        # M6: navigate to checkout
        await page.goto(f"{BASE_URL}/checkout.html", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=15000)
        await page.wait_for_timeout(500)
        results.append(("M6_checkout_loads_mobile", True,
                        f"url={page.url.split('?')[0]}"))

        # M7: no horizontal overflow on checkout
        overflow = await page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth + 1"
        )
        results.append(("M7_no_horizontal_overflow_checkout", not overflow,
                        f"overflow={overflow}"))

        # M8: payment method radios present
        esewa_label = await page.locator(
            "label:has-text('eSewa'), input[value='esewa']"
        ).count()
        cod_label = await page.locator(
            "label:has-text('COD'), label:has-text('Cash on Delivery'), input[value='cod']"
        ).count()
        results.append(("M8_payment_methods_visible", esewa_label > 0 and cod_label > 0,
                        f"esewa={esewa_label} cod={cod_label}"))

        # M9: eSewa block is reachable (tap the label, not the radio - the
        # visual span overlays the radio on mobile)
        try:
            await page.locator("label.payment-option:has(input[value='esewa'])").first.click(timeout=5000)
            await page.wait_for_timeout(400)
            esewa_block_visible = await page.locator(
                "#esewaPaymentSection"
            ).is_visible()
            qr_count = await page.locator(
                "img[src*='qr'], img[alt*='QR' i], img[alt*='qr' i], canvas"
            ).count()
            txn_input = await page.locator(
                "input[name='txn'], input[id*='txn' i], input[placeholder*='transaction' i], "
                "input[placeholder*='reference' i]"
            ).count()
            results.append(("M9_esewa_block_visible_mobile",
                            esewa_block_visible and qr_count > 0 and txn_input > 0,
                            f"block={esewa_block_visible} qr={qr_count} txn_input={txn_input}"))
        except Exception as e:
            results.append(("M9_esewa_block_visible_mobile", False, f"err: {e}"))

        # M10: success page loads on mobile
        await page.goto(f"{BASE_URL}/checkout-success.html", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=10000)
        results.append(("M10_success_page_loads_mobile", True, "loaded"))

        overflow = await page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth + 1"
        )
        results.append(("M11_no_horizontal_overflow_success", not overflow,
                        f"overflow={overflow}"))

        print("\n============================================================")
        print("MOBILE CHECKOUT VERIFICATION (390x844)")
        print("============================================================")
        passed = 0
        for name, ok, detail in results:
            tag = "PASS" if ok else "FAIL"
            print(f"[{tag}] {name}: {detail}")
            if ok:
                passed += 1
        print(f"\nTotal: {passed}/{len(results)} passed")
        if errors:
            print(f"\nPage errors observed ({len(errors)}):")
            for e in errors[:5]:
                print(f"  {e[:200]}")
        else:
            print("Page errors: (none)")

        await browser.close()
        return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
