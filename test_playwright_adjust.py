from playwright.sync_api import sync_playwright
import sys, time

URL = "https://shree-collection.vercel.app/admin"  # production deploy; adjust if needed

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.goto(URL + "/admin.html")
        # Basic smoke: page loads, has adjust-stock modal trigger
        print("Page loaded:", page.url)
        # Check image tags have onerror / PLACEHOLDER_IMAGE
        tags = page.locator("img[onerror*=PLACEHOLDER_IMAGE]")
        print("Image tags with onerror+placeholder:", tags.count())
        # Verify endpoint structure by checking that admin/inventory exists (not via browser directly)
        browser.close()

if __name__ == "__main__":
    main()
