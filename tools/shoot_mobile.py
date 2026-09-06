"""Capture mobile-viewport screenshots of the live Shree Collection site.

Saves full-page and viewport-only PNGs to tools/mobile_shots/ so the user
can compare against what they see on their phone.

Usage:
    python tools/shoot_mobile.py
    python tools/shoot_mobile.py --url https://shree-collection-opal.vercel.app
"""
import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_URL = "https://shree-collection-opal.vercel.app"
OUT_DIR = Path(__file__).parent / "mobile_shots"

# (label, viewport_width, viewport_height, device_scale_factor, user_agent hint)
VIEWPORTS = [
    ("iphone_se",  375,  667, 2),  # small iPhone
    ("iphone_14",  390,  844, 3),  # modern iPhone
    ("android_sm", 360,  800, 2),  # small Android
    ("tablet",     768, 1024, 2),  # tablet breakpoint
]


def shoot(page, label, url, out_dir):
    print(f"  [{label}] navigating {url}", flush=True)
    # Cache-buster so we definitely get the freshest CSS
    page.goto(url + ("?v=" + str(int(time.time()))), wait_until="networkidle", timeout=30000)
    # Force a hard reload to bypass any browser-level cache
    page.reload(wait_until="networkidle", timeout=30000)
    time.sleep(1.0)

    # Viewport-only (what the user sees without scrolling)
    vp_path = out_dir / f"{label}_viewport.png"
    page.screenshot(path=str(vp_path), full_page=False)
    print(f"    saved {vp_path.name}", flush=True)

    # Full page
    fp_path = out_dir / f"{label}_fullpage.png"
    page.screenshot(path=str(fp_path), full_page=True)
    print(f"    saved {fp_path.name}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--out", default=str(OUT_DIR))
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, w, h, dpr in VIEWPORTS:
            context = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=dpr,
                is_mobile=(w < 768),
                has_touch=True,
            )
            page = context.new_page()
            shoot(page, label, args.url, out_dir)
            context.close()
        browser.close()

    print(f"\nDone. {len(VIEWPORTS)} viewports saved to {out_dir}")


if __name__ == "__main__":
    main()
