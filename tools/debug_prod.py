"""Debug what Playwright actually sees on the production storefront."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright

from playwright.async_api import async_playwright

BASE = resolve_base_url()
print(f"[debug_prod] using BASE_URL = {BASE}", flush=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            env=clean_env_for_playwright(),
        )
        ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await ctx.new_page()

        msgs = []
        page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: msgs.append(f"[pageerror] {e}"))

        await page.goto(f"{BASE}/", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(3000)

        # Check what's actually in the DOM
        info = await page.evaluate("""
            () => {
                return {
                    title: document.title,
                    url: window.location.href,
                    bodyHTML_length: document.body.innerHTML.length,
                    hasSupabaseClient: typeof supabaseClient !== 'undefined' && supabaseClient !== null,
                    supabaseClientType: typeof supabaseClient,
                    hasAddToCart: typeof addToCart,
                    hasOpenCartDrawer: typeof openCartDrawer,
                    hasCartBtn: !!document.getElementById('cartBtn'),
                    hasCartDrawer: !!document.getElementById('cartDrawer'),
                    hasNavHeader: !!document.querySelector('nav, header'),
                    hasMainElement: !!document.querySelector('main'),
                    bodyChildren: Array.from(document.body.children).map(e => e.tagName + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ').join('.') : '')).slice(0, 10),
                    scriptCount: document.querySelectorAll('script').length,
                };
            }
        """)
        print("Page info:", info)
        print()
        print("Console messages:")
        for m in msgs[:30]:
            print("  " + m)

        await browser.close()


asyncio.run(main())
