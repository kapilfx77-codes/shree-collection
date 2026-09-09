#!/usr/bin/env python3
"""Playwright verification for admin inventory image fix."""
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()
        # Load file directly to inspect markup (no deploy needed)
        page.goto("file://" + "D:/Shree Website/admin.html")
        # Wait briefly for DOM
        page.wait_for_timeout(200)
        # Search the rendered string for the placeholder structure
        html = page.content()
        # Check conditions
        checks = {
            "has_inventory_placeholder_div": "inventory-image-placeholder" in html,
            "no_svg_data_uri_in_inventory_region": "data:image/svg+xml" not in html,  # simplified; full file may still contain PLACEHOLDER_IMAGE elsewhere
            "placeholder_has_48px": "width:48px;height:48px" in html,
        }
        print("Checks:", checks)
        # Inspect computed style via evaluate (approximate)
        result = page.evaluate("""
            () => {
                const div = document.querySelector('.inventory-image-placeholder');
                if (!div) return { found: false };
                const rect = div.getBoundingClientRect();
                return { found: true, width: rect.width, height: rect.height, tag: div.tagName };
            }
        """)
        print("Placeholder computed:", result)
        b.close()

if __name__ == "__main__":
    main()
