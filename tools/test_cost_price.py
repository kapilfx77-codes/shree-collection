"""
Cost Price (CP) feature test suite.
CP01–CP27: create/edit/validation/security/FIFO/CP-prefill
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
    line = f"[{tag}] {name}: {detail}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        print(line, flush=True)


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

        # ── Navigate to admin ──────────────────────────────────────────────────
        await page.goto(f"{BASE}/admin.html", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # ── Login ──────────────────────────────────────────────────────────────
        try:
            await page.wait_for_selector("#loginSection", timeout=8000)
        except Exception:
            pass
        login_section = await page.locator("#loginSection").count()
        if login_section > 0:
            pw_input = page.locator("#passwordInput")
            if await pw_input.count() > 0:
                import os
                pw = os.environ.get("ADMIN_PW") or os.environ.get("SUPABASE_ADMIN_PASSWORD", "admin123")
                await pw_input.fill(pw)
                await page.locator("#loginBtn").click()
                await page.wait_for_timeout(3000)
        await page.wait_for_timeout(2000)

        # ── Helper: create a test product via API ──────────────────────────────
        import json, os, asyncio

        async def api(method, path, body=None, token=None):
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            r = await ctx.request.fetch(f"{BASE}{path}", method=method,
                                        headers=headers,
                                        data=json.dumps(body) if body else None)
            try:
                return r.status, await r.json()
            except Exception:
                return r.status, {}

        # ── Helper: open Add Product modal ──────────────────────────────────────
        async def open_add_product_modal():
            add_btn = page.locator("button:has-text('Add Product'), button.btn-gold:has-text('Product')").first
            await add_btn.click()
            await page.wait_for_timeout(500)

        # ── Helper: fill minimal product form ──────────────────────────────────
        async def fill_minimal_form(product_name, price=999, orig_price=None, cost_price=None):
            await page.locator("#productName").fill(product_name)
            await page.locator("#productPrice").fill(str(price))
            await page.locator("#productDescription").fill(f"Test product for CP suite: {product_name}")
            await page.locator("#productSizes").fill("S, M")
            await page.locator("#productColors").fill("Red, Blue")
            if orig_price is not None:
                await page.locator("#productOriginalPrice").fill(str(orig_price))
            if cost_price is not None:
                await page.locator("#productCostPrice").fill(str(cost_price))

        # ── Helper: submit product form ─────────────────────────────────────────
        async def submit_product_form():
            await page.locator("#productSaveBtn").click()
            await page.wait_for_timeout(3000)

        # ── Helper: delete product ─────────────────────────────────────────────
        async def delete_product(name):
            # Navigate to products tab
            prods_tab = page.locator("[data-section='products'], .nav-item:has-text('Products')").first
            await prods_tab.click()
            await page.wait_for_timeout(1000)
            # Find the product row
            rows = page.locator(".card, .product-row")
            for i in range(await rows.count()):
                txt = await rows.nth(i).text_content()
                if name in txt:
                    del_btn = rows.nth(i).locator("button:has-text('Delete'), .delete-btn")
                    if await del_btn.count() > 0:
                        await del_btn.first.click()
                        await page.wait_for_timeout(500)
                        # Handle confirmation
                        dialogs = page.locator("dialog[open], .confirm-dialog")
                        if await dialogs.count() > 0:
                            confirm_btn = page.locator("button:has-text('Confirm'), button:has-text('Delete'), button.btn-danger")
                            if await confirm_btn.count() > 0:
                                await confirm_btn.first.click()
                                await page.wait_for_timeout(1000)
                        break

        # ═══════════════════════════════════════════════════════════════════════
        # CP01: cost_price nullable (create without CP)
        # ═══════════════════════════════════════════════════════════════════════
        await open_add_product_modal()
        await fill_minimal_form("CP01 Test Product", price=500)
        # Leave cost_price empty
        await submit_product_form()
        await page.wait_for_timeout(2000)
        # Verify success toast
        toast = await page.locator(".toast:has-text('Product created')").count()
        results.append(("CP01_cost_price_nullable_create", toast > 0, f"toast shown={toast > 0}"))

        # Find and delete
        await delete_product("CP01 Test Product")

        # ═══════════════════════════════════════════════════════════════════════
        # CP02: cost_price accepted on create (positive number)
        # ═══════════════════════════════════════════════════════════════════════
        await open_add_product_modal()
        await fill_minimal_form("CP02 Test Product", price=1000, cost_price=650)
        await submit_product_form()
        await page.wait_for_timeout(2000)
        toast = await page.locator(".toast:has-text('Product created')").count()
        results.append(("CP02_cost_price_create_positive", toast > 0, f"created={toast > 0}"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP03: cost_price accepted on create (decimal)
        # ═══════════════════════════════════════════════════════════════════════
        await open_add_product_modal()
        await fill_minimal_form("CP03 Test Product", price=1200, cost_price=825.50)
        await submit_product_form()
        await page.wait_for_timeout(2000)
        toast = await page.locator(".toast:has-text('Product created')").count()
        results.append(("CP03_cost_price_create_decimal", toast > 0, f"created={toast > 0}"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP04: cost_price = 0 accepted (explicit zero)
        # ═══════════════════════════════════════════════════════════════════════
        await open_add_product_modal()
        await fill_minimal_form("CP04 Test Product", price=800, cost_price=0)
        await submit_product_form()
        await page.wait_for_timeout(2000)
        toast = await page.locator(".toast:has-text('Product created')").count()
        results.append(("CP04_cost_price_zero_accepted", toast > 0, f"created={toast > 0}"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP05: cost_price negative rejected
        # ═══════════════════════════════════════════════════════════════════════
        await open_add_product_modal()
        await fill_minimal_form("CP05 Test Product", price=700, cost_price=-100)
        await submit_product_form()
        await page.wait_for_timeout(2000)
        # Should show error — form should stay open, no success toast
        toast = await page.locator(".toast:has-text('Product created')").count()
        modal_open = await page.locator("#productModal.open").count()
        results.append(("CP05_cost_price_negative_rejected", not toast > 0 and modal_open > 0,
                        f"no-success={not toast > 0} modal-open={modal_open > 0}"))
        # Close modal
        close_btn = page.locator("#productModal .close")
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(300)

        # ═══════════════════════════════════════════════════════════════════════
        # CP06: cost_price editable on existing product
        # ═══════════════════════════════════════════════════════════════════════
        # Edit CP02 product
        prods_tab = page.locator("[data-section='products'], .nav-item:has-text('Products')").first
        await prods_tab.click()
        await page.wait_for_timeout(1000)
        rows = page.locator(".card, .product-row")
        for i in range(await rows.count()):
            txt = await rows.nth(i).text_content()
            if "CP02" in txt:
                edit_btn = rows.nth(i).locator("button:has-text('Edit'), .edit-btn")
                if await edit_btn.count() > 0:
                    await edit_btn.first.click()
                    await page.wait_for_timeout(800)
                    break
        cp_field = page.locator("#productCostPrice")
        modal_open = await page.locator("#productModal.open").count()
        if modal_open > 0:
            # Check if cost_price is pre-filled
            cp_val = await cp_field.input_value()
            results.append(("CP06_cost_price_edit_prefilled", cp_val == "650", f"prefilled={cp_val}"))
            # Update cost_price
            await cp_field.fill("700.00")
            await page.locator("#productSaveBtn").click()
            await page.wait_for_timeout(2000)
            toast = await page.locator(".toast:has-text('updated')").count()
            results.append(("CP07_cost_price_update_success", toast > 0, f"updated={toast > 0}"))
        else:
            results.append(("CP06_cost_price_edit_prefilled", False, "modal not opened"))
            results.append(("CP07_cost_price_update_success", False, "skipped"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP08: cost_price NOT in page source on catalog
        # ═══════════════════════════════════════════════════════════════════════
        cat_page = await ctx.new_page()
        await cat_page.goto(f"{BASE}/catalog.html", wait_until="networkidle")
        await cat_page.wait_for_timeout(2000)
        src = await cat_page.content()
        has_cp_in_src = "cost_price" in src and "CP02 Test Product" in src
        results.append(("CP08_cost_price_not_in_catalog_source", not has_cp_in_src,
                        f"cost_price leaked={has_cp_in_src}"))
        await cat_page.close()

        # ═══════════════════════════════════════════════════════════════════════
        # CP09: cost_price NOT in JavaScript objects on catalog
        # ═══════════════════════════════════════════════════════════════════════
        cat_page2 = await ctx.new_page()
        await cat_page2.goto(f"{BASE}/catalog.html", wait_until="networkidle")
        await cat_page2.wait_for_timeout(2000)
        leaked = await cat_page2.evaluate("""
            () => {
                const cards = document.querySelectorAll('.product-card');
                for (const card of cards) {
                    const html = card.innerHTML;
                    if (html.includes('cost_price')) return true;
                }
                return false;
            }
        """)
        results.append(("CP09_cost_price_not_in_catalog_dom", not leaked,
                        f"leaked in DOM={leaked}"))
        await cat_page2.close()

        # ═══════════════════════════════════════════════════════════════════════
        # CP10: Add Stock modal pre-fills unit cost from product CP
        # ═══════════════════════════════════════════════════════════════════════
        # Go to inventory section
        inv_tab = page.locator("[data-section='inventory'], .nav-item:has-text('Inventory')").first
        await inv_tab.click()
        await page.wait_for_timeout(1500)
        # Find CP02 product row
        rows = page.locator(".card")
        for i in range(await rows.count()):
            txt = await rows.nth(i).text_content()
            if "CP02" in txt:
                add_stock_btn = rows.nth(i).locator("button:has-text('Add Stock')")
                if await add_stock_btn.count() > 0:
                    await add_stock_btn.first.click()
                    await page.wait_for_timeout(800)
                    break
        add_stock_modal = await page.locator("#addStockModal.open").count()
        if add_stock_modal > 0:
            cost_val = await page.locator("#addStockCost").input_value()
            # Should be prefilled with CP02's cost_price (700.00)
            results.append(("CP10_add_stock_prefills_unit_cost", cost_val == "700" or cost_val == "700.00",
                            f"prefilled={cost_val!r}"))
        else:
            results.append(("CP10_add_stock_prefills_unit_cost", False, "add stock modal not opened"))
        close_btn = page.locator("#addStockModal .close")
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(300)

        # ═══════════════════════════════════════════════════════════════════════
        # CP11: Add Stock with NULL CP leaves unit cost empty
        # ═══════════════════════════════════════════════════════════════════════
        # Find CP01 product (no CP set)
        for i in range(await rows.count()):
            txt = await rows.nth(i).text_content()
            if "CP01" in txt:
                add_stock_btn = rows.nth(i).locator("button:has-text('Add Stock')")
                if await add_stock_btn.count() > 0:
                    await add_stock_btn.first.click()
                    await page.wait_for_timeout(800)
                    break
        add_stock_modal2 = await page.locator("#addStockModal.open").count()
        if add_stock_modal2 > 0:
            cost_val2 = await page.locator("#addStockCost").input_value()
            # Should be empty string (NULL CP → no prefill)
            results.append(("CP11_null_cp_leaves_unit_cost_empty", cost_val2 == "",
                            f"cost_val={cost_val2!r}"))
        else:
            results.append(("CP11_null_cp_leaves_unit_cost_empty", False, "add stock modal not opened"))
        close_btn = page.locator("#addStockModal .close")
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(300)

        # ═══════════════════════════════════════════════════════════════════════
        # CP12: Add Stock form validates unit cost >= 0
        # ═══════════════════════════════════════════════════════════════════════
        # Add stock with negative cost
        for i in range(await rows.count()):
            txt = await rows.nth(i).text_content()
            if "CP02" in txt:
                add_stock_btn = rows.nth(i).locator("button:has-text('Add Stock')")
                if await add_stock_btn.count() > 0:
                    await add_stock_btn.first.click()
                    await page.wait_for_timeout(800)
                    break
        add_stock_modal3 = await page.locator("#addStockModal.open").count()
        if add_stock_modal3 > 0:
            await page.locator("#addStockQty").fill("5")
            await page.locator("#addStockCost").fill("-50")
            await page.locator("button:has-text('Add Stock')").click()
            await page.wait_for_timeout(500)
            err_text = await page.locator("#addStockError").text_content()
            results.append(("CP12_add_stock_negative_cost_rejected", "negative" in err_text.lower() or "valid" in err_text.lower(),
                            f"error shown={err_text!r}"))
        else:
            results.append(("CP12_add_stock_negative_cost_rejected", False, "modal not opened"))
        close_btn = page.locator("#addStockModal .close")
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(300)

        # ═══════════════════════════════════════════════════════════════════════
        # CP13: Server rejects cost_price < 0 via API
        # ═══════════════════════════════════════════════════════════════════════
        status, body = await api("POST", "/api/admin/products", {
            "name": "CP13 Reject Test",
            "price": 500,
            "cost_price": -10
        })
        results.append(("CP13_server_rejects_negative_cost_price",
                        status == 400,
                        f"status={status}"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP14: Server accepts cost_price = 0 via API
        # ═══════════════════════════════════════════════════════════════════════
        status, body = await api("POST", "/api/admin/products", {
            "name": "CP14 Zero CP Test",
            "price": 500,
            "cost_price": 0
        })
        results.append(("CP14_server_accepts_zero_cost_price",
                        status == 201,
                        f"status={status}"))
        if status == 201 and body.get("product"):
            cp14_id = body["product"].get("id")
        else:
            cp14_id = None

        # ═══════════════════════════════════════════════════════════════════════
        # CP15: Server accepts NULL cost_price via API
        # ═══════════════════════════════════════════════════════════════════════
        status, body = await api("POST", "/api/admin/products", {
            "name": "CP15 Null CP Test",
            "price": 500
            # no cost_price field at all
        })
        results.append(("CP15_server_accepts_null_cost_price",
                        status == 201,
                        f"status={status}"))
        if status == 201 and body.get("product"):
            cp15_id = body["product"].get("id")
        else:
            cp15_id = None

        # ═══════════════════════════════════════════════════════════════════════
        # CP16: Server accepts decimal cost_price via API
        # ═══════════════════════════════════════════════════════════════════════
        status, body = await api("POST", "/api/admin/products", {
            "name": "CP16 Decimal CP Test",
            "price": 800,
            "cost_price": 412.75
        })
        results.append(("CP16_server_accepts_decimal_cost_price",
                        status == 201,
                        f"status={status}"))
        if status == 201 and body.get("product"):
            cp16_id = body["product"].get("id")
        else:
            cp16_id = None

        # ═══════════════════════════════════════════════════════════════════════
        # CP17: PATCH updates cost_price correctly via API
        # ═══════════════════════════════════════════════════════════════════════
        if cp14_id:
            status, body = await api("PATCH", "/api/admin/products", {
                "id": cp14_id,
                "cost_price": 250.50
            })
            results.append(("CP17_patch_updates_cost_price",
                            status == 200 and body.get("product", {}).get("cost_price") == 250.50,
                            f"status={status} cp={body.get('product', {}).get('cost_price')}"))
        else:
            results.append(("CP17_patch_updates_cost_price", False, "cp14_id not found"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP18: PATCH accepts cost_price = null via API (clear CP)
        # ═══════════════════════════════════════════════════════════════════════
        if cp14_id:
            status, body = await api("PATCH", "/api/admin/products", {
                "id": cp14_id,
                "cost_price": None
            })
            results.append(("CP18_patch_clears_cost_price",
                            status == 200,
                            f"status={status}"))
        else:
            results.append(("CP18_patch_clears_cost_price", False, "skipped"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP19: PATCH rejects cost_price = -1 via API
        # ═══════════════════════════════════════════════════════════════════════
        if cp14_id:
            status, body = await api("PATCH", "/api/admin/products", {
                "id": cp14_id,
                "cost_price": -1
            })
            results.append(("CP19_patch_rejects_negative_cost_price",
                            status == 400,
                            f"status={status}"))
        else:
            results.append(("CP19_patch_rejects_negative_cost_price", False, "skipped"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP20: cost_price never in GET /api/products (public catalog)
        # ═══════════════════════════════════════════════════════════════════════
        status, body = await api("GET", "/api/products")
        if isinstance(body, dict) and "products" in body:
            products_list = body["products"]
            has_cp = any("cost_price" in p for p in products_list) if isinstance(products_list, list) else False
        else:
            has_cp = False
        results.append(("CP20_public_api_excludes_cost_price", not has_cp,
                        f"status={status} cost_price leaked={has_cp}"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP21: cost_price never in GET /api/products/{id} (public detail)
        # ═══════════════════════════════════════════════════════════════════════
        if cp16_id:
            status, body = await api("GET", f"/api/products/{cp16_id}")
            has_cp = "cost_price" in body if isinstance(body, dict) else False
            results.append(("CP21_public_detail_excludes_cost_price", not has_cp,
                            f"cost_price leaked={has_cp}"))
        else:
            results.append(("CP21_public_detail_excludes_cost_price", False, "cp16_id not found"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP22: Admin API GET includes cost_price
        # ═══════════════════════════════════════════════════════════════════════
        status, body = await api("GET", "/api/admin/products")
        if isinstance(body, dict) and "products" in body:
            prods = body["products"]
            has_cp_admin = any("cost_price" in p for p in prods) if isinstance(prods, list) else False
        else:
            has_cp_admin = False
        results.append(("CP22_admin_api_includes_cost_price", has_cp_admin,
                        f"admin includes cost_price={has_cp_admin}"))

        # ═══════════════════════════════════════════════════════════════════════
        # CP23: Homepage (featured products) excludes cost_price
        # ═══════════════════════════════════════════════════════════════════════
        home_page = await ctx.new_page()
        await home_page.goto(f"{BASE}/", wait_until="networkidle")
        await home_page.wait_for_timeout(2000)
        leaked_home = await home_page.evaluate("""
            () => {
                const cards = document.querySelectorAll('.product-card, .featured-card');
                for (const card of cards) {
                    if (card.innerHTML.includes('cost_price')) return true;
                }
                return false;
            }
        """)
        results.append(("CP23_homepage_excludes_cost_price", not leaked_home,
                        f"leaked={leaked_home}"))
        await home_page.close()

        # ═══════════════════════════════════════════════════════════════════════
        # CP24: Checkout page excludes cost_price
        # ═══════════════════════════════════════════════════════════════════════
        checkout_page = await ctx.new_page()
        await checkout_page.goto(f"{BASE}/checkout.html", wait_until="networkidle")
        await checkout_page.wait_for_timeout(2000)
        # Add something to cart first
        cat_page3 = await ctx.new_page()
        await cat_page3.goto(f"{BASE}/catalog.html", wait_until="networkidle")
        await cat_page3.wait_for_timeout(2000)
        add_cart_btn = cat_page3.locator(".add-to-cart, .btn-cart").first
        if await add_cart_btn.count() > 0:
            await add_cart_btn.click()
            await cat_page3.wait_for_timeout(1000)
        await cat_page3.close()
        await checkout_page.reload(wait_until="networkidle")
        await checkout_page.wait_for_timeout(2000)
        leaked_checkout = await checkout_page.evaluate("""
            () => document.body.innerHTML.includes('cost_price')
        """)
        results.append(("CP24_checkout_excludes_cost_price", not leaked_checkout,
                        f"leaked={leaked_checkout}"))
        await checkout_page.close()

        # ═══════════════════════════════════════════════════════════════════════
        # CP25: cost_price field present in admin product modal
        # ═══════════════════════════════════════════════════════════════════════
        prods_tab2 = page.locator("[data-section='products'], .nav-item:has-text('Products')").first
        await prods_tab2.click()
        await page.wait_for_timeout(1000)
        await open_add_product_modal()
        cp_field_exists = await page.locator("#productCostPrice").count()
        results.append(("CP25_admin_modal_has_cp_field", cp_field_exists > 0,
                        f"field exists={cp_field_exists > 0}"))
        close_btn = page.locator("#productModal .close")
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(300)

        # ═══════════════════════════════════════════════════════════════════════
        # CP26: Cost Price field labeled as private
        # ═══════════════════════════════════════════════════════════════════════
        await open_add_product_modal()
        label = await page.locator("label:has(#productCostPrice)").text_content()
        if not label:
            labels = await page.locator("label").all_text_contents()
            label = next((l for l in labels if "cost" in l.lower()), "")
        results.append(("CP26_cp_field_label_present", "cost" in label.lower() if label else False,
                        f"label={label!r}"))
        close_btn = page.locator("#productModal .close")
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(300)

        # ═══════════════════════════════════════════════════════════════════════
        # CP27: No JS console errors during any operation
        # ═══════════════════════════════════════════════════════════════════════
        results.append(("CP27_no_console_errors", len(errors) == 0,
                        f"errors={len(errors)} {errors[:2]}"))

        # ── Cleanup: delete test products ─────────────────────────────────────
        for name in ["CP02 Test Product", "CP03 Test Product", "CP04 Test Product",
                     "CP13 Reject Test"]:
            await delete_product(name)
        # Clean up API-created products
        for pid in [cp14_id, cp15_id, cp16_id]:
            if pid:
                await api("DELETE", "/api/admin/products", {"id": pid})

        await ctx.close()
        await browser.close()

    print("\n" + "=" * 60)
    print("COST PRICE TEST SUITE (CP01–CP27)")
    print("=" * 60)
    passed = 0
    for name, ok, detail in results:
        log(name, ok, detail)
        if ok:
            passed += 1
    print(f"\nTotal: {passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(__import__("asyncio").run(main()))
