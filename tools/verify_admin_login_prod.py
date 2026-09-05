"""
One-shot Playwright verification of the admin login page against production.

Runs ONLY against the live production URL. Does not perform any destructive
operation. The user must supply ADMIN_PASSWORD via env; default is the
documented 'shree2026' fallback used elsewhere in this project.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright

from playwright.async_api import async_playwright  # noqa: E402

PROD = resolve_base_url()
PASSWORD = os.environ.get("ADMIN_PASSWORD", "shree2026")

print(f"[verify_admin] BASE = {PROD}", flush=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-proxy-server"],
            env=clean_env_for_playwright(),
        )
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
        )
        page = await ctx.new_page()
        page.set_default_timeout(30000)

        # Load admin page
        resp = await page.goto(f"{PROD}/admin.html", wait_until="networkidle")
        print(f"  /admin.html -> status={resp.status} url={page.url}", flush=True)

        # Find the password field
        try:
            await page.wait_for_selector("input[type='password']", timeout=10000)
            print("  [PASS] password field present", flush=True)
        except Exception as e:
            print(f"  [FAIL] password field not found: {e}", flush=True)
            await browser.close()
            return

        await page.fill("input[type='password']", PASSWORD)
        # Click the login submit button
        try:
            await page.click("button:has-text('Sign In'), button:has-text('Login'), "
                             "button[type='submit']", timeout=5000)
        except Exception as e:
            print(f"  [WARN] login click failed: {e}", flush=True)

        # Wait a moment for the login flow
        await page.wait_for_timeout(2500)
        title = await page.title()
        url = page.url
        print(f"  after login: title='{title}' url={url}", flush=True)
        # Save screenshot
        shot = os.path.join(os.path.dirname(__file__), "verify_admin_after_login.png")
        await page.screenshot(path=shot, full_page=True)
        print(f"  screenshot saved: {shot}", flush=True)

        await browser.close()


asyncio.run(main())
