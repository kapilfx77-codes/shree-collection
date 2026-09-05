"""End-to-end security test for the admin password change flow.

Exercises:
    1. login with current password (the table-seeded hash) → 200 + token
    2. open Settings, the form is rendered
    3. wrong current password → inline error 400
    4. mismatched new/confirm → client-side error
    5. new == current → client-side error
    6. weak new (too short) → client-side error
    7. strong new password → success banner, fresh token in sessionStorage
    8. reload → still authenticated with the new token
    9. logout, try OLD password → 401
    10. login with NEW password → 200
    11. (cleanup) change back to the original password so the admin's
        working password is preserved
    12. (cleanup verification) login with the original password → 200

Runs ONLY against the live production URL.

Required environment variables (exported in the shell that invokes this
test; the file does NOT hardcode the admin password):
    SHREE_TEST_CURRENT_PASSWORD  - the admin's CURRENT password (e.g. the
                                    seed default after 002 ran)
    SHREE_TEST_NEW_PASSWORD      - the temporary password the test will
                                    set, then revert. Defaults to
                                    'ShreeTest!2026-XYZ' if unset.
"""
import asyncio
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _test_env import resolve_base_url, clean_env_for_playwright

from playwright.async_api import async_playwright

BASE = resolve_base_url()
# Both passwords are read from the environment so nothing sensitive is
# committed to the repo. The defaults below are intentionally NOT the
# production admin password — they only kick in if the env vars are
# missing, which makes the test fail loudly in that case.
ORIGINAL_PASSWORD = os.environ.get("SHREE_TEST_CURRENT_PASSWORD", "")
TEST_PASSWORD     = os.environ.get("SHREE_TEST_NEW_PASSWORD", "ShreeTest!2026-XYZ")
if not ORIGINAL_PASSWORD:
    print("[test_change_password] SHREE_TEST_CURRENT_PASSWORD is not set; "
          "export it to the admin's current password before running this test.",
          file=sys.stderr, flush=True)
    sys.exit(2)

print(f"[test_change_password] BASE = {BASE}", flush=True)


async def post_login(page, password):
    """Helper: call /api/login from the page context, return (status, body)."""
    return await page.evaluate(
        """async (pwd) => {
            const r = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            let data = null;
            try { data = await r.json(); } catch {}
            return { status: r.status, body: data };
        }""",
        password,
    )


async def post_change_password(page, token, current, new_pwd, confirm):
    """Helper: call /api/admin/change-password with bearer auth."""
    return await page.evaluate(
        """async ({ token, current, newPassword, confirmPassword }) => {
            const r = await fetch('/api/admin/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ currentPassword: current, newPassword, confirmPassword })
            });
            let data = null;
            try { data = await r.json(); } catch {}
            return { status: r.status, body: data };
        }""",
        {"token": token, "current": current, "newPassword": new_pwd, "confirmPassword": confirm},
    )


async def get_token(page):
    return await page.evaluate("() => sessionStorage.getItem('shree_admin_token') || ''")


async def main():
    failures = []
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

        # ---- Step 1: login with current (original) password ----
        await page.goto(f"{BASE}/admin.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(800)
        r = await post_login(page, ORIGINAL_PASSWORD)
        if r["status"] != 200 or not r["body"].get("success"):
            failures.append(f"step 1: initial login with original password failed: {r}")
        else:
            print(f"[step 1] PASS login(original) -> 200", flush=True)
        original_token = r["body"].get("token", "")
        if not original_token:
            failures.append("step 1: no token in initial login response")

        # Stash the token in sessionStorage so subsequent page.evaluate calls
        # in this context use it. (adminChangePassword() in admin.js does
        # the same — it reads from sessionStorage via getAdminToken().)
        await page.evaluate("t => sessionStorage.setItem('shree_admin_token', t)", original_token)
        await page.evaluate("() => sessionStorage.setItem('shree_admin_auth', 'true')")

        # ---- Step 2: open the Settings page, form must be rendered ----
        await page.goto(f"{BASE}/admin.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(800)
        # Click the Settings nav item
        clicked = await page.evaluate("""
            () => {
                const a = document.querySelector('#adminNav a[data-page=\"settings\"]');
                if (!a) return { ok: false, why: 'no Settings link' };
                a.click();
                return { ok: true };
            }
        """)
        if not clicked.get("ok"):
            failures.append(f"step 2: could not find Settings nav link: {clicked}")
        else:
            await page.wait_for_timeout(500)
            form_state = await page.evaluate("""
                () => {
                    const f = document.getElementById('changePasswordForm');
                    return {
                        formExists: !!f,
                        activePage: document.querySelector('.admin-page.active')?.dataset.page,
                        fields: {
                            current: !!document.getElementById('cpCurrent'),
                            newPwd: !!document.getElementById('cpNew'),
                            confirm: !!document.getElementById('cpConfirm'),
                            submit: !!document.getElementById('cpSubmit'),
                        }
                    };
                }
            """)
            if not form_state["formExists"] or form_state["activePage"] != "settings":
                failures.append(f"step 2: Settings form not rendered: {form_state}")
            else:
                print(f"[step 2] PASS Settings page rendered with all 4 form fields", flush=True)

        # ---- Step 3: try wrong current password via the API directly ----
        token = await get_token(page)
        r = await post_change_password(page, token, "wrong-password-xxx", "ValidNew!2026abc", "ValidNew!2026abc")
        if r["status"] != 400:
            failures.append(f"step 3: wrong current pwd expected 400, got {r['status']}: {r['body']}")
        else:
            print(f"[step 3] PASS wrong current pwd -> 400 ({r['body'].get('error')})", flush=True)

        # ---- Step 4: try mismatched new/confirm via the form ----
        await page.fill('#cpCurrent', ORIGINAL_PASSWORD)
        await page.fill('#cpNew', 'Mismatched!2026')
        await page.fill('#cpConfirm', 'OtherValue!2026')
        await page.click('#cpSubmit')
        await page.wait_for_timeout(400)
        err = await page.evaluate("() => { const e = document.getElementById('cpError'); return { hidden: e.hidden, text: e.textContent }; }")
        if err["hidden"] or "match" not in err["text"].lower():
            failures.append(f"step 4: mismatched confirm did not surface error: {err}")
        else:
            print(f"[step 4] PASS mismatched new/confirm shows inline error: {err['text']!r}", flush=True)

        # ---- Step 5: new == current ----
        # We deliberately use a 12+ char placeholder for "current" so the
        # browser's native minlength=12 validation doesn't pre-empt our
        # client-side check. The placeholder doesn't need to match the
        # real current password — we only want the JS validator to catch
        # the equality and surface the "different" error.
        placeholder = "TestSame!2026ABC"
        await page.fill('#cpCurrent', placeholder)
        await page.fill('#cpNew', placeholder)
        await page.fill('#cpConfirm', placeholder)
        await page.click('#cpSubmit')
        await page.wait_for_timeout(400)
        err = await page.evaluate("() => { const e = document.getElementById('cpError'); return { hidden: e.hidden, text: e.textContent }; }")
        if err["hidden"] or "different" not in err["text"].lower():
            failures.append(f"step 5: new==current did not surface error: {err}")
        else:
            print(f"[step 5] PASS new==current shows inline error: {err['text']!r}", flush=True)

        # ---- Step 6: weak new (too short) ----
        await page.fill('#cpCurrent', ORIGINAL_PASSWORD)
        await page.fill('#cpNew', 'short')
        await page.fill('#cpConfirm', 'short')
        await page.click('#cpSubmit')
        await page.wait_for_timeout(400)
        err = await page.evaluate("() => { const e = document.getElementById('cpError'); return { hidden: e.hidden, text: e.textContent }; }")
        if err["hidden"] or "12" not in err["text"]:
            failures.append(f"step 6: short pwd did not surface error: {err}")
        else:
            print(f"[step 6] PASS short pwd shows inline error: {err['text']!r}", flush=True)

        # ---- Step 7: change to strong test password ----
        await page.fill('#cpCurrent', ORIGINAL_PASSWORD)
        await page.fill('#cpNew', TEST_PASSWORD)
        await page.fill('#cpConfirm', TEST_PASSWORD)
        await page.click('#cpSubmit')
        # Wait for the banner to appear (success path)
        try:
            await page.wait_for_function(
                "() => { const b = document.getElementById('settingsSecurityStatus'); return b && !b.hidden; }",
                timeout=8000,
            )
        except Exception as e:
            banner = await page.evaluate("() => { const b = document.getElementById('settingsSecurityStatus'); return { hidden: b.hidden, text: b.textContent, class: b.className }; }")
            err = await page.evaluate("() => { const e = document.getElementById('cpError'); return { hidden: e.hidden, text: e.textContent }; }")
            failures.append(f"step 7: success banner never appeared: banner={banner}, err={err}")
        else:
            banner = await page.evaluate("() => { const b = document.getElementById('settingsSecurityStatus'); return { hidden: b.hidden, text: b.textContent, class: b.className }; }")
            if banner["hidden"] or "ok" not in banner["class"]:
                failures.append(f"step 7: banner not in 'ok' state: {banner}")
            else:
                print(f"[step 7] PASS strong pwd change shows success banner", flush=True)
            # Verify a fresh token replaced the old one
            new_token = await get_token(page)
            if not new_token or new_token == original_token:
                failures.append(f"step 7: session token was not replaced (original={bool(original_token)}, new={bool(new_token)}, same={new_token==original_token})")
            else:
                print(f"[step 7] PASS sessionStorage token was replaced", flush=True)

        # ---- Step 8: reload, still authenticated ----
        await page.goto(f"{BASE}/admin.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        # The login form should NOT be showing; the app shell should be visible.
        shell_state = await page.evaluate("""
            () => {
                const shell = document.getElementById('adminShell');
                const login = document.getElementById('adminLoginModal');
                return {
                    shellDisplay: getComputedStyle(shell).display,
                    loginDisplay: getComputedStyle(login).display,
                };
            }
        """)
        if shell_state["shellDisplay"] == "none" or shell_state["loginDisplay"] != "none":
            failures.append(f"step 8: reload did not keep user logged in: {shell_state}")
        else:
            print(f"[step 8] PASS reload still authenticated (adminShell visible)", flush=True)

        # ---- Step 9: logout, try OLD password → 401 ----
        await page.evaluate("() => { sessionStorage.removeItem('shree_admin_token'); sessionStorage.removeItem('shree_admin_auth'); }")
        r = await post_login(page, ORIGINAL_PASSWORD)
        if r["status"] != 401:
            failures.append(f"step 9: login with OLD password should be 401, got {r['status']}: {r['body']}")
        else:
            print(f"[step 9] PASS login(old) -> 401 ({r['body'].get('error')})", flush=True)

        # ---- Step 10: login with NEW password → 200 ----
        r = await post_login(page, TEST_PASSWORD)
        if r["status"] != 200 or not r["body"].get("success"):
            failures.append(f"step 10: login with NEW password should be 200, got {r['status']}: {r['body']}")
        else:
            print(f"[step 10] PASS login(new) -> 200", flush=True)
        restored_token = r["body"].get("token", "")
        await page.evaluate("t => sessionStorage.setItem('shree_admin_token', t)", restored_token)
        await page.evaluate("() => sessionStorage.setItem('shree_admin_auth', 'true')")

        # ---- Step 11 (cleanup): change back to the original password ----
        r = await post_change_password(page, restored_token, TEST_PASSWORD, ORIGINAL_PASSWORD, ORIGINAL_PASSWORD)
        if r["status"] != 200 or not r["body"].get("success"):
            failures.append(f"step 11: cleanup change back to original failed: {r['status']}: {r['body']}")
        else:
            print(f"[step 11] PASS cleanup: changed password back to original", flush=True)
            # Use the freshly-issued token for the next call
            restored_token = r["body"].get("token", restored_token)

        # ---- Step 12 (cleanup verification): login with original → 200 ----
        await page.evaluate("() => { sessionStorage.removeItem('shree_admin_token'); sessionStorage.removeItem('shree_admin_auth'); }")
        r = await post_login(page, ORIGINAL_PASSWORD)
        if r["status"] != 200 or not r["body"].get("success"):
            failures.append(f"step 12: final verification login with original failed: {r['status']}: {r['body']}")
        else:
            print(f"[step 12] PASS final verification: login(original) -> 200", flush=True)

        if errors:
            failures.append(f"JS errors on page: {errors}")

        await browser.close()

    print()
    print("=" * 60)
    if failures:
        print("RESULT: FAIL")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("RESULT: ALL 12 STEPS PASSED")


asyncio.run(main())
