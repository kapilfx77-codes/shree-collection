"""Force-fresh mobile screenshots — bypasses ALL caches by using a custom
HTTPS route that adds no-cache headers, and disables HTTP cache in the context.
"""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

DEFAULT_URL = "https://shree-collection-opal.vercel.app"
OUT_DIR = Path(__file__).parent / "mobile_shots"

VIEWPORTS = [
    ("iphone_se",  375,  667, 2),
    ("iphone_14",  390,  844, 3),
    ("android_sm", 360,  800, 2),
    ("tablet",     768, 1024, 2),
]


def shoot(page, label, url, out_dir):
    bust = int(time.time() * 1000)
    target = f"{url}/?v={bust}"
    print(f"  [{label}] {target}", flush=True)
    # Disable HTTP cache in the context (set on the route handler) below.
    # No wait_until=networkidle (some assets may hang). Use domcontentloaded.
    page.goto(target, wait_until="domcontentloaded", timeout=30000)
    # Wait for CSS to apply and animation to actually start
    page.wait_for_load_state("load", timeout=15000)
    page.wait_for_timeout(2000)

    vp_path = out_dir / f"{label}_viewport.png"
    page.screenshot(path=str(vp_path), full_page=False)
    print(f"    saved {vp_path.name}", flush=True)

    fp_path = out_dir / f"{label}_fullpage.png"
    page.screenshot(path=str(fp_path), full_page=True)
    print(f"    saved {fp_path.name}", flush=True)


def main():
    out_dir = OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        # Fresh context with cache disabled and a route that adds no-cache headers
        for label, w, h, dpr in VIEWPORTS:
            context = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=dpr,
                is_mobile=(w < 768),
                has_touch=True,
            )
            # Disable HTTP cache for the entire context
            context.set_extra_http_headers({"Cache-Control": "no-cache, no-store", "Pragma": "no-cache"})
            # Intercept all requests and add no-cache on the response
            def add_no_cache(route):
                response = route.fetch()
                headers = dict(response.headers)
                headers["cache-control"] = "no-store, no-cache, must-revalidate, max-age=0"
                headers["pragma"] = "no-cache"
                route.fulfill(response=response, headers=headers)
            context.route("**/*", add_no_cache)
            page = context.new_page()
            shoot(page, label, DEFAULT_URL, out_dir)
            context.close()
        browser.close()

    print(f"\nDone. {len(VIEWPORTS)} viewports saved to {out_dir}")


if __name__ == "__main__":
    main()
