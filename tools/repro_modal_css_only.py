"""CSS-only test: open productModal via JS, capture state.

This bypasses admin login to focus purely on whether the modal CSS
renders correctly when the .open class is added.
"""
import asyncio
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright

from playwright.async_api import async_playwright

BASE = resolve_base_url()
print(f"[repro_modal_css_only] BASE = {BASE}", flush=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-proxy-server"],
            env=clean_env_for_playwright(),
        )
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            ignore_https_errors=True,
        )
        page = await ctx.new_page()
        page.set_default_timeout(30000)

        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        await page.goto(f"{BASE}/admin.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        # Open the productModal directly (no login)
        result = await page.evaluate("""
            () => {
                const m = document.getElementById('productModal');
                if (!m) return { error: 'no productModal' };
                // Make adminShell visible if it isn't (it should be display:grid)
                const shell = document.getElementById('adminShell');
                if (shell) shell.style.display = 'grid';
                m.classList.add('open');

                // Also check the inner modal
                const inner = m.querySelector('.modal');
                const innerS = inner ? getComputedStyle(inner) : null;
                const r = inner ? inner.getBoundingClientRect() : null;
                return {
                    modal: { open: m.classList.contains('open'), display: getComputedStyle(m).display },
                    inner: innerS ? {
                        display: innerS.display,
                        visibility: innerS.visibility,
                        opacity: innerS.opacity,
                        position: innerS.position,
                        background: innerS.background.substring(0, 80),
                        maxWidth: innerS.maxWidth,
                        width: innerS.width,
                        rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
                    } : null,
                };
            }
        """)
        print(f"[modal-opened] {result}", flush=True)

        # Screenshot
        shot = os.path.join(os.path.dirname(__file__), "repro_modal_opened.png")
        await page.screenshot(path=shot, full_page=True)
        print(f"[screenshot] {shot}", flush=True)

        # Check if any element is on top of the modal card area
        if result.get("inner", {}).get("rect"):
            r = result["inner"]["rect"]
            topmost = await page.evaluate(f"""
                () => {{
                    const cx = {r['x']} + {r['w']} / 2;
                    const cy = {r['y']} + {r['h']} / 2;
                    const el = document.elementFromPoint(cx, cy);
                    return el ? {{ tag: el.tagName, id: el.id, cls: el.className, z: getComputedStyle(el).zIndex }} : null;
                }}
            """)
            print(f"[topmost] at modal center: {topmost}", flush=True)

        print("ERRORS:", errors)
        await browser.close()


asyncio.run(main())
