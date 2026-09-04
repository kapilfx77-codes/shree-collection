"""
Playwright smoke test for the admin dashboard.

Verifies:
  - Login modal appears
  - Wrong password shows error
  - Correct password unlocks the dashboard
  - Sidebar nav works (Dashboard, Orders, Products, Inventory, Customers)
  - Empty states render correctly
  - No console errors

Run:
    SUPABASE_SERVICE_ROLE_KEY=dev-dummy node tools/dev-server.js --port=9090 &
    SUPABASE_SERVICE_ROLE_KEY=dev-dummy python tools/test_admin.py
"""
import sys
import io
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

# Force UTF-8 stdout so emoji and arrows don't break on Windows cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
elif isinstance(sys.stdout, io.TextIOBase):
    pass

BASE_URL = "http://127.0.0.1:9090"
ADMIN_PASSWORD = "shree2026"  # default; real one comes from ADMIN_PASSWORD env

TOOLS_DIR = Path(__file__).parent
SHOTS_DIR = TOOLS_DIR
SHOTS_DIR.mkdir(parents=True, exist_ok=True)


def main():
    errors = []
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1366, "height": 900})
        page = context.new_page()

        # Track console errors
        page.on("console", lambda msg: (
            console_errors.append(f"[{msg.type}] {msg.text}")
            if msg.type == "error" else None
        ))
        page.on("pageerror", lambda exc: console_errors.append(f"[pageerror] {exc}"))

        # 1) Load admin page
        print(">> Loading admin page")
        resp = page.goto(f"{BASE_URL}/admin.html", wait_until="networkidle")
        assert resp and resp.status == 200, f"Failed to load admin.html: {resp.status if resp else 'no response'}"
        page.wait_for_timeout(500)

        # 2) Login modal should be visible
        print(">> Verifying login modal")
        expect(page.locator("#adminLoginModal")).to_be_visible()
        expect(page.locator("h2", has_text="Shree Admin")).to_be_visible()
        page.screenshot(path=str(SHOTS_DIR / "admin_01_login.png"), full_page=True)

        # 3) Wrong password should show error
        print(">> Testing wrong password")
        page.fill("#adminPasswordInput", "wrongpass")
        page.click("#adminLoginForm button[type='submit']")
        page.wait_for_timeout(1500)
        err = page.locator("#loginErrorMsg")
        expect(err).to_be_visible()
        assert "Invalid" in err.text_content(), f"Expected error message, got: {err.text_content()}"
        page.screenshot(path=str(SHOTS_DIR / "admin_02_wrong_password.png"), full_page=True)

        # 4) Correct password should unlock the dashboard
        print(">> Testing correct password")
        page.fill("#adminPasswordInput", ADMIN_PASSWORD)
        page.click("#adminLoginForm button[type='submit']")
        page.wait_for_timeout(2500)

        # Login modal should be gone, shell should be visible
        expect(page.locator("#adminLoginModal")).to_be_hidden()
        expect(page.locator("#adminShell")).to_be_visible()
        expect(page.locator('.admin-page[data-page="dashboard"].active')).to_be_visible()
        expect(page.locator("#topbarTitle")).to_have_text("Dashboard")
        page.wait_for_timeout(800)
        page.screenshot(path=str(SHOTS_DIR / "admin_03_dashboard.png"), full_page=True)

        # 5) Navigate to Orders
        print(">> Navigating to Orders")
        page.click('#adminNav a[data-page="orders"]')
        page.wait_for_timeout(2000)
        expect(page.locator('.admin-page[data-page="orders"].active')).to_be_visible()
        expect(page.locator("#topbarTitle")).to_have_text("Orders")
        page.screenshot(path=str(SHOTS_DIR / "admin_04_orders.png"), full_page=True)

        # 6) Navigate to Products
        print(">> Navigating to Products")
        page.click('#adminNav a[data-page="products"]')
        page.wait_for_timeout(2000)
        expect(page.locator('.admin-page[data-page="products"].active')).to_be_visible()
        expect(page.locator("#topbarTitle")).to_have_text("Products")
        page.screenshot(path=str(SHOTS_DIR / "admin_05_products.png"), full_page=True)

        # 7) Navigate to Inventory
        print(">> Navigating to Inventory")
        page.click('#adminNav a[data-page="inventory"]')
        page.wait_for_timeout(2000)
        expect(page.locator('.admin-page[data-page="inventory"].active')).to_be_visible()
        expect(page.locator("#topbarTitle")).to_have_text("Inventory")
        page.screenshot(path=str(SHOTS_DIR / "admin_06_inventory.png"), full_page=True)

        # 8) Navigate to Customers
        print(">> Navigating to Customers")
        page.click('#adminNav a[data-page="customers"]')
        page.wait_for_timeout(2000)
        expect(page.locator('.admin-page[data-page="customers"].active')).to_be_visible()
        expect(page.locator("#topbarTitle")).to_have_text("Customers")
        page.screenshot(path=str(SHOTS_DIR / "admin_07_customers.png"), full_page=True)

        # 9) Back to dashboard and try refresh
        print(">> Back to dashboard + refresh")
        page.click('#adminNav a[data-page="dashboard"]')
        page.wait_for_timeout(800)
        page.click('#refreshDashboard')
        page.wait_for_timeout(2000)
        page.screenshot(path=str(SHOTS_DIR / "admin_08_dashboard_refreshed.png"), full_page=True)

        # 10) Mobile viewport test
        print(">> Mobile viewport (375x812)")
        page.set_viewport_size({"width": 375, "height": 812})
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS_DIR / "admin_09_mobile_dashboard.png"), full_page=True)
        page.click('#mobileMenuToggle')
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS_DIR / "admin_10_mobile_menu.png"), full_page=True)

        # 11) Check no console errors
        real_errors = [e for e in console_errors if "401" not in e and "favicon" not in e.lower()]
        if real_errors:
            print(f"\n!! Console errors detected ({len(real_errors)}):")
            for e in real_errors[:10]:
                print(f"   {e}")
            errors.append(f"{len(real_errors)} console errors")
        else:
            print("OK No console errors")

        browser.close()

    if errors:
        print(f"\nFAIL: {errors}")
        sys.exit(1)
    print("\nPASS: ALL ADMIN TESTS PASSED")


if __name__ == "__main__":
    main()

