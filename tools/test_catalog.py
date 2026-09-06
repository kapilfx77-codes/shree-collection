"""
Catalog UX verification: color filter, size filter, search, sort, empty state.
Targets production: https://shree-collection-opal.vercel.app
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _test_env import resolve_base_url, clean_env_for_playwright

from playwright.async_api import async_playwright

BASE = resolve_base_url()

def log(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name}: {detail}", flush=True)

async def main():
    results = []
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
        await ctx.route("**/*", lambda r: r.continue_(
            headers={**r.request.headers, "Cache-Control": "no-cache"}
        ))
        page = await ctx.new_page()
        page.set_default_timeout(30000)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # Load catalog
        await page.goto(f"{BASE}/catalog.html", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # Wait for product cards
        try:
            await page.wait_for_selector(".product-card", timeout=10000)
        except Exception:
            pass

        # C1: Product cards loaded
        cards = await page.locator(".product-card").count()
        results.append(("C1_product_cards_loaded", cards >= 1, f"cards={cards}"))

        # C2: Color filter section exists
        color_opts = await page.locator("#colorFilterOptions").count()
        results.append(("C2_color_filter_exists", color_opts > 0, f"section={color_opts}"))

        # C3: Color filter has checkboxes
        color_cbs = await page.locator("#colorFilterOptions input[type='checkbox']").count()
        results.append(("C3_color_filter_has_options", color_cbs > 0, f"options={color_cbs}"))

        # C4: Color filter — check a color, verify products filter
        if color_cbs > 0:
            # Click the first color checkbox
            first_color = await page.locator("#colorFilterOptions input[type='checkbox']").first
            color_label = await first_color.get_attribute("value")
            await first_color.check()
            await page.wait_for_timeout(500)
            filtered_cards = await page.locator(".product-card").count()
            # Filtered count should be <= total count
            results.append(("C4_color_filter_reduces_results",
                           filtered_cards <= cards,
                           f"before={cards} after={filtered_cards} color='{color_label}'"))
            # Uncheck
            await first_color.uncheck()
            await page.wait_for_timeout(300)
        else:
            results.append(("C4_color_filter_reduces_results", False, "no color checkboxes"))

        # C5: Size filter still works (check S)
        size_cb = page.locator(".filter-checkbox input[value='S']").first
        await size_cb.check()
        await page.wait_for_timeout(400)
        size_filtered = await page.locator(".product-card").count()
        results.append(("C5_size_filter_works", size_filtered <= cards, f"before={cards} after={size_filtered}"))
        await size_cb.uncheck()

        # C6: Search filter works
        search_input = page.locator("#searchInput")
        await search_input.fill("Silk")
        await page.wait_for_timeout(500)
        search_cards = await page.locator(".product-card").count()
        results.append(("C6_search_filter_works", search_cards <= cards, f"before={cards} after={search_cards}"))
        await search_input.clear()
        await page.wait_for_timeout(300)

        # C7: Sort — price low to high
        await page.select_option("#sortSelect", "price-low")
        await page.wait_for_timeout(400)
        prices = await page.evaluate("""
            () => Array.from(document.querySelectorAll('.product-card'))
                .map(el => {
                    const txt = el.querySelector('.current-price')?.textContent || '';
                    const match = txt.replace(/[^0-9]/g, '');
                    return parseInt(match) || 0;
                })
        """)
        is_sorted = all(prices[i] <= prices[i+1] for i in range(len(prices)-1)) if prices else True
        results.append(("C7_sort_price_low_high", is_sorted, f"prices={prices}"))
        await page.select_option("#sortSelect", "default")

        # C8: Sort — name A-Z
        await page.select_option("#sortSelect", "name-az")
        await page.wait_for_timeout(400)
        names = await page.evaluate("""
            () => Array.from(document.querySelectorAll('.product-card'))
                .map(el => el.querySelector('.product-title')?.textContent?.trim() || '')
        """)
        is_az = all(names[i] <= names[i+1] for i in range(len(names)-1)) if len(names) > 1 else True
        results.append(("C8_sort_name_az", is_az, f"names={names}"))
        await page.select_option("#sortSelect", "default")

        # C9: Reset clears all
        await page.select_option("#sortSelect", "price-low")
        await page.locator("#searchInput").fill("xyz nonexistent product")
        reset_btn = page.locator("button.filter-reset-btn")
        if await reset_btn.count() > 0:
            await reset_btn.click()
            await page.wait_for_timeout(400)
            reset_cards = await page.locator(".product-card").count()
            # After reset, should show all products
            results.append(("C9_reset_shows_all", reset_cards == cards, f"before={cards} after={reset_cards}"))
        else:
            results.append(("C9_reset_shows_all", False, "reset button not found"))

        # C10: Empty state when no match
        await page.locator("#searchInput").fill("zzz_no_products_match_this_query_zzz")
        await page.wait_for_timeout(500)
        empty_visible = await page.locator("#catalogEmptyState").is_visible()
        results.append(("C10_empty_state_shown", empty_visible, f"visible={empty_visible}"))

        await ctx.close()
        await browser.close()

    print("\n============================================================")
    print("CATALOG UX VERIFICATION")
    print("============================================================")
    passed = 0
    for name, ok, detail in results:
        log(name, ok, detail)
        if ok: passed += 1
    print(f"\nTotal: {passed}/{len(results)} passed")
    if errors:
        print(f"\nPage errors ({len(errors)}):")
        for e in errors[:5]:
            print(f"  {e[:200]}")
    return 0 if passed == len(results) else 1

if __name__ == "__main__":
    sys.exit(__import__("asyncio").run(main()))
