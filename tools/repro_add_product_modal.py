"""Reproduce the Add Product modal bug against production.

Loads /admin, logs in, navigates to Products, clicks Add Product,
then dumps the actual computed state of #productModal and the inner
.modal element. Captures before/after screenshots.
"""
import asyncio
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright

from playwright.async_api import async_playwright

BASE = resolve_base_url()
PASSWORD = os.environ.get("ADMIN_PASSWORD", "shree2026")
print(f"[repro_add_product] BASE = {BASE}", flush=True)


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
            bypass_csp=True,
        )
        page = await ctx.new_page()
        page.set_default_timeout(30000)

        errors = []
        console = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))

        # Load admin
        resp = await page.goto(f"{BASE}/admin.html", wait_until="networkidle")
        print(f"[step1] /admin.html status={resp.status} url={page.url}", flush=True)

        # Login
        await page.wait_for_selector("input[type='password']", timeout=10000)
        await page.fill("input[type='password']", PASSWORD)
        try:
            await page.click("button:has-text('Sign In'), button[type='submit']", timeout=5000)
        except Exception as e:
            print(f"[step2] login click err: {e}", flush=True)
        await page.wait_for_timeout(2500)
        print(f"[step2] after login: url={page.url} title={await page.title()}", flush=True)

        # Navigate to Products section
        # The admin likely has tabs; click "Products"
        clicked = False
        for sel in [
            "a:has-text('Products')",
            "button:has-text('Products')",
            "[data-tab='products']",
            "[data-section='products']",
        ]:
            try:
                el = await page.query_selector(sel)
                if el:
                    await el.click()
                    clicked = True
                    print(f"[step3] clicked Products via {sel}", flush=True)
                    break
            except Exception:
                pass
        if not clicked:
            print("[step3] could not find Products tab; trying default view", flush=True)
        await page.wait_for_timeout(800)

        # Screenshot BEFORE clicking Add Product
        before = os.path.join(os.path.dirname(__file__), "repro_before_add.png")
        await page.screenshot(path=before, full_page=True)
        print(f"[step4] saved {before}", flush=True)

        # Inspect addProductBtn and productModal state BEFORE click
        before_state = await page.evaluate("""
            () => {
                const btn = document.getElementById('addProductBtn');
                const m = document.getElementById('productModal');
                const inner = m ? m.querySelector('.modal') : null;
                function desc(el) {
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return {
                        tag: el.tagName,
                        id: el.id,
                        className: el.className,
                        display: s.display,
                        visibility: s.visibility,
                        opacity: s.opacity,
                        position: s.position,
                        zIndex: s.zIndex,
                        top: s.top, left: s.left, right: s.right, bottom: s.bottom,
                        transform: s.transform,
                        overflow: s.overflow,
                        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                        offsetParent: el.offsetParent ? el.offsetParent.tagName + '#' + (el.offsetParent.id || '') : null,
                    };
                }
                return {
                    btn: desc(btn),
                    modal: desc(m),
                    inner: desc(inner),
                    modalOpen: m ? m.classList.contains('open') : null,
                    bodyClass: document.body.className,
                    htmlClass: document.documentElement.className,
                };
            }
        """)
        print(f"[step4] BEFORE state:\n{before_state}", flush=True)

        # Click Add Product
        try:
            await page.click("#addProductBtn", timeout=5000)
            print("[step5] clicked #addProductBtn", flush=True)
        except Exception as e:
            print(f"[step5] click err: {e}", flush=True)
        await page.wait_for_timeout(800)

        # Screenshot AFTER
        after = os.path.join(os.path.dirname(__file__), "repro_after_add.png")
        await page.screenshot(path=after, full_page=True)
        print(f"[step5] saved {after}", flush=True)

        # Inspect state AFTER
        after_state = await page.evaluate("""
            () => {
                const btn = document.getElementById('addProductBtn');
                const m = document.getElementById('productModal');
                const inner = m ? m.querySelector('.modal') : null;
                const form = document.getElementById('productForm');
                function desc(el) {
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return {
                        tag: el.tagName,
                        id: el.id,
                        className: el.className,
                        display: s.display,
                        visibility: s.visibility,
                        opacity: s.opacity,
                        position: s.position,
                        zIndex: s.zIndex,
                        top: s.top, left: s.left, right: s.right, bottom: s.bottom,
                        transform: s.transform,
                        overflow: s.overflow,
                        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                        offsetParent: el.offsetParent ? el.offsetParent.tagName + '#' + (el.offsetParent.id || '') : null,
                        outerHTMLstart: el.outerHTML.substring(0, 250),
                    };
                }
                // Walk up parents to find the nearest ancestor with display:none / visibility:hidden / 0 opacity
                function ancestorChain(el) {
                    const chain = [];
                    let n = el;
                    while (n && n !== document.documentElement) {
                        const s = getComputedStyle(n);
                        chain.push({
                            tag: n.tagName,
                            id: n.id,
                            class: n.className,
                            display: s.display,
                            visibility: s.visibility,
                            opacity: s.opacity,
                        });
                        n = n.parentElement;
                    }
                    return chain;
                }
                return {
                    btn: desc(btn),
                    modal: desc(m),
                    inner: desc(inner),
                    form: desc(form),
                    modalOpen: m ? m.classList.contains('open') : null,
                    modalInnerChain: inner ? ancestorChain(inner) : null,
                    inputCount: form ? form.querySelectorAll('input,textarea,select').length : null,
                    firstFieldName: form ? (form.querySelector('[name="name"]') ? form.querySelector('[name="name"]').value : null) : null,
                    bodyClass: document.body.className,
                };
            }
        """)
        print(f"[step5] AFTER state:\n{after_state}", flush=True)

        # Also check: are there any elements positioned ABOVE the modal?
        # (i.e. something with higher z-index covering it)
        topmost = await page.evaluate("""
            () => {
                const m = document.getElementById('productModal');
                if (!m) return null;
                const r = m.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                const cx = r.x + r.width / 2;
                const cy = r.y + r.height / 2;
                const top = document.elementFromPoint(cx, cy);
                if (!top) return null;
                return {
                    topTag: top.tagName,
                    topId: top.id,
                    topClass: top.className,
                    topZ: getComputedStyle(top).zIndex,
                    isModalOrInside: m.contains(top) || top === m,
                };
            }
        """)
        print(f"[step6] elementFromPoint at modal center: {topmost}", flush=True)

        print()
        print("=" * 60)
        print("CONSOLE")
        print("=" * 60)
        for c in console[-30:]:
            print(c)
        print()
        print("=" * 60)
        print("PAGE ERRORS")
        print("=" * 60)
        for e in errors:
            print(e)

        await browser.close()


asyncio.run(main())
