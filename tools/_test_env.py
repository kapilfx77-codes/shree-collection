"""
Shared test-process configuration for Shree Collection smoke / regression tests.

Why this module exists
----------------------
The shell that launches these tests (Claude Code / OmniRoute) exports a number
of variables for its own model-routing infrastructure, including:

    ANTHROPIC_BASE_URL     = http://localhost:20128
    BASE_URL               = http://localhost:20128     (OmniRoute gateway)
    NEXT_PUBLIC_BASE_URL   = http://localhost:20128
    ENABLE_SOCKS5_PROXY    = true
    NEXT_PUBLIC_ENABLE_SOCKS5_PROXY = true
    INSPECTOR_HTTP_PROXY_*  = ...
    OMNIROUTE_USE_TURBOPACK = 1
    MACHINE_ID_SALT        = endpoint-proxy-salt

A naive `BASE = os.environ.get("BASE_URL", PROD)` in a smoke test would
silently inherit BASE_URL=http://localhost:20128 and navigate Playwright to
the local OmniRoute gateway instead of the production Vercel site.

To prevent that, this module:
  * Resolves the production URL with a strict precedence order that does
    NOT consult the generic BASE_URL variable. The only env vars consulted
    are SHREE_BASE_URL (explicit override) and the hardcoded default.
  * Builds a cleaned child environment for the Playwright Chromium
    process with the OmniRoute/proxy variables stripped, so a future
    regression in env handling cannot cause Playwright to be routed
    through a SOCKS proxy intended for Claude Code.
  * Exposes a single function, `clean_env_for_playwright()`, that callers
    pass to `p.chromium.launch(env=...)`.

This file MUST NOT print any secret values. Only variable names are logged.
"""
import os
import sys

# The single source of truth for the production URL used by smoke tests.
# This is the URL the website actually advertises (Vercel auto-generated alias).
PROD_URL = "https://shree-collection-opal.vercel.app"

# Env vars that exist on this host for OmniRoute / Claude Code / proxy
# infrastructure and must NEVER be inherited by the test process.
OMNIROUTE_PROXY_VARS = (
    "BASE_URL",            # intentionally NOT the Shree var name
    "NEXT_PUBLIC_BASE_URL",
    "ANTHROPIC_BASE_URL",
    "ENABLE_SOCKS5_PROXY",
    "NEXT_PUBLIC_ENABLE_SOCKS5_PROXY",
    "MACHINE_ID_SALT",
    "INSPECTOR_HTTP_PROXY_PORT",
    "INSPECTOR_HTTP_PROXY_AUTOSTART",
    "INSPECTOR_SYSTEM_PROXY_GUARD_MINUTES",
    "OMNIROUTE_USE_TURBOPACK",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
)


def resolve_base_url(explicit=None):
    """Return the production URL the test should target.

    Precedence (highest first):
      1. `explicit` argument (if provided and non-empty)
      2. `SHREE_BASE_URL` env var (the only env var that may override the
         hardcoded production URL — uses a project-specific name so it
         cannot collide with OmniRoute/Claude Code variables)
      3. Hardcoded `PROD_URL`

    The generic `BASE_URL` env var is intentionally NOT consulted because
    on this host it points to the OmniRoute gateway, not to a web service.
    """
    if explicit:
        return explicit.rstrip("/")
    shree = os.environ.get("SHREE_BASE_URL", "").strip()
    if shree:
        return shree.rstrip("/")
    return PROD_URL


def clean_env_for_playwright(extra=None, log_stripped=True):
    """Return a child env suitable for `p.chromium.launch(env=...)`.

    Strips every OmniRoute/proxy variable listed in OMNIROUTE_PROXY_VARS,
    plus any variable whose name contains PROXY or SOCKS (defence in depth),
    then merges in any `extra` overrides. `extra` values of None delete
    the variable; non-None values set it.
    """
    env = os.environ.copy()
    stripped = []
    for k in OMNIROUTE_PROXY_VARS:
        if k in env:
            del env[k]
            stripped.append(k)
    for k in list(env.keys()):
        if k in stripped:
            continue
        if "PROXY" in k.upper() or "SOCKS" in k.upper():
            del env[k]
            stripped.append(k)
    if extra:
        for k, v in extra.items():
            if v is None:
                env.pop(k, None)
            else:
                env[k] = v
    if log_stripped:
        print(
            f"[test_env] cleaned child env: stripped {len(stripped)} vars "
            f"({', '.join(stripped) or 'none'})",
            file=sys.stderr, flush=True,
        )
    return env
