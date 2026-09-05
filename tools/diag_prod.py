"""
Diagnostic: capture requested URL, final URL, HTTP status, and page title
under four conditions (B, C, D1, D2) to isolate the proxy/BASE_URL issue.
Also runs A: a baseline curl-equivalent header probe for comparison.

Does NOT echo any secret values. Only prints non-sensitive metadata.
"""
import asyncio
import os
import sys
import subprocess
import json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROD = "https://shree-collection-opal.vercel.app"
REDACTED_KEYS = ("KEY", "SECRET", "TOKEN", "PASSWORD", "PASS", "AUTH")
PROXY_VARS = (
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "ENABLE_SOCKS5_PROXY", "NEXT_PUBLIC_ENABLE_SOCKS5_PROXY",
    "MACHINE_ID_SALT", "INSPECTOR_HTTP_PROXY_PORT",
    "INSPECTOR_HTTP_PROXY_AUTOSTART", "INSPECTOR_SYSTEM_PROXY_GUARD_MINUTES",
    "OMNIROUTE_USE_TURBOPACK", "ANTHROPIC_BASE_URL", "BASE_URL",
    "NEXT_PUBLIC_BASE_URL",
)


def safe_env_for_child():
    """Return a copy of os.environ with the proxy-related vars removed.

    Never prints values; only the names of what is being stripped.
    """
    env = os.environ.copy()
    stripped = []
    for k in PROXY_VARS:
        if k in env:
            del env[k]
            stripped.append(k)
    # Also strip anything containing PROXY or SOCKS
    for k in list(env.keys()):
        if ("PROXY" in k.upper() or "SOCKS" in k.upper()) and k not in stripped:
            del env[k]
            stripped.append(k)
    print(f"  [child env] stripped {len(stripped)} vars: {stripped}", flush=True)
    return env


def list_sensitive_env():
    """Print non-sensitive env values that are relevant to the issue."""
    print("  [parent env] relevant variables (values redacted if sensitive):")
    for k in sorted(os.environ.keys()):
        if "PROXY" in k.upper() or "SOCKS" in k.upper() or k.upper() in (
            "BASE_URL", "NEXT_PUBLIC_BASE_URL", "ANTHROPIC_BASE_URL",
            "OMNIROUTE_USE_TURBOPACK", "MACHINE_ID_SALT",
            "INSPECTOR_HTTP_PROXY_PORT", "INSPECTOR_HTTP_PROXY_AUTOSTART",
            "INSPECTOR_SYSTEM_PROXY_GUARD_MINUTES",
        ):
            v = os.environ[k]
            if any(s in k.upper() for s in REDACTED_KEYS):
                v = "<redacted>"
            elif k.upper() == "BASE_URL" or k.upper().endswith("_BASE_URL"):
                # Show the URL — that's exactly the value we need to see.
                v = v
            print(f"    {k} = {v}", flush=True)


def run_curl(label, url):
    print(f"\n=== {label}: curl {url} ===", flush=True)
    try:
        out = subprocess.run(
            ["curl.exe", "-sS", "-o", "NUL",
             "-w", "status=%{http_code} url=%{url_effective} size=%{size_download}\n",
             "-L", url],
            capture_output=True, text=True, timeout=30,
        )
        print(out.stdout.strip(), flush=True)
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)


async def run_playwright(label, env_overrides, launch_args, hardcode_base=False):
    print(f"\n=== {label} ===", flush=True)
    # Build a clean child env: parent env minus proxy stuff, plus overrides.
    child_env = safe_env_for_child()
    for k, v in env_overrides.items():
        if v is None:
            child_env.pop(k, None)
        else:
            child_env[k] = v

    if hardcode_base:
        base = PROD
    else:
        # Read the value that the test process would actually see.
        base = child_env.get("BASE_URL", PROD)
    print(f"  [child env] effective BASE_URL = {base!r}", flush=True)

    from playwright.async_api import async_playwright
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=launch_args,
                env=child_env,
            )
            ctx = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                ignore_https_errors=True,
            )
            page = await ctx.new_page()
            page.set_default_timeout(20000)
            requested = f"{base}/index.html"
            print(f"  requested URL: {requested}", flush=True)
            try:
                resp = await page.goto(requested, wait_until="domcontentloaded")
                status = resp.status if resp else None
            except Exception as e:
                status = f"EXC: {e}"
            final_url = page.url
            try:
                title = await page.title()
            except Exception:
                title = "<title unavailable>"
            print(f"  final URL:   {final_url}", flush=True)
            print(f"  HTTP status: {status}", flush=True)
            print(f"  page title:  {title}", flush=True)
            await browser.close()
    except Exception as e:
        print(f"  ERROR launching playwright: {e}", flush=True)


async def main():
    print("Parent environment (relevant vars):", flush=True)
    list_sensitive_env()

    # A: normal curl
    run_curl("A (curl to production, no Playwright)", f"{PROD}/index.html")

    # B: Playwright with current (parent) environment inherited.
    #    Use a child env that contains the parent's vars (as-is).
    print("\n=== B: Playwright with current parent environment (inherits BASE_URL) ===", flush=True)
    print(f"  [parent env] BASE_URL = {os.environ.get('BASE_URL')!r}", flush=True)
    from playwright.async_api import async_playwright
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
            page = await ctx.new_page()
            base = os.environ.get("BASE_URL", PROD)
            print(f"  effective BASE_URL = {base!r}", flush=True)
            try:
                resp = await page.goto(f"{base}/index.html", wait_until="domcontentloaded")
                print(f"  HTTP status: {resp.status}", flush=True)
            except Exception as e:
                print(f"  EXC: {e}", flush=True)
            print(f"  final URL:   {page.url}", flush=True)
            try:
                print(f"  page title:  {await page.title()}", flush=True)
            except Exception:
                print("  page title:  <unavailable>", flush=True)
            await browser.close()
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)

    # C: Playwright with proxy env vars removed; BASE_URL stripped too.
    await run_playwright(
        "C: Playwright with proxy + BASE_URL stripped, no launch proxy args",
        env_overrides={},  # all stripped by safe_env_for_child
        launch_args=[],
        hardcode_base=False,  # so the stripped BASE_URL default is PROD
    )

    # D1: Playwright with prod URL hardcoded AND proxy vars stripped,
    #     and --no-proxy-server flag added.
    await run_playwright(
        "D1: Playwright with hardcoded prod URL, proxy env stripped, --no-proxy-server",
        env_overrides={},
        launch_args=["--no-proxy-server"],
        hardcode_base=True,
    )

    # D2: Same as D1 but with the chromium launch env *also* explicitly cleared
    #     of the SOCKS variables and a fresh launch.
    await run_playwright(
        "D2: Playwright with hardcoded prod URL, all SOCKS+PROXY env stripped at launch",
        env_overrides={
            "BASE_URL": PROD,
            "ENABLE_SOCKS5_PROXY": None,
            "NEXT_PUBLIC_ENABLE_SOCKS5_PROXY": None,
        },
        launch_args=["--no-proxy-server"],
        hardcode_base=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
