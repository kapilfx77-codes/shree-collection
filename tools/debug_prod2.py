"""Debug T1 vs T2 difference in smoke test."""
import asyncio, os, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright
from playwright.async_api import async_playwright

BASE = resolve_base_url()
print(f"[debug_prod2] using BASE_URL = {BASE}", flush=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            env=clean_env_for_playwright(),
        )
        ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await ctx.new_page()
        page.set_default_timeout(30000)
        page.on("pageerror", lambda e: print("PAGEERROR:", e))

        # T1 exactly as smoke test does it
        print("=== T1: going to", f"{BASE}/index.html")
        resp = await page.goto(f"{BASE}/index.html", wait_until="networkidle")
        print("T1 status:", resp.status)
        print("T1 url:", page.url)
        print("T1 title:", await page.title())
        print("T1 body snippet:", (await page.evaluate("() => document.body.innerText.substring(0, 100)")))

        # T2
        print("\n=== T2: going to", f"{BASE}/catalog.html")
        resp = await page.goto(f"{BASE}/catalog.html", wait_until="networkidle")
        print("T2 status:", resp.status)
        print("T2 url:", page.url)
        print("T2 title:", await page.title())

        # T3 back to index
        print("\n=== T3: going back to", f"{BASE}/index.html")
        resp = await page.goto(f"{BASE}/index.html", wait_until="networkidle")
        print("T3 status:", resp.status)
        print("T3 url:", page.url)
        print("T3 title:", await page.title())

        await browser.close()


asyncio.run(main())
