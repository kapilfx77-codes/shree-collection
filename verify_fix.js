// verify_fix.js — Playwright: checkout 1, 2, 3 products against production
// Tests that /api/orders returns 200 (not 409 OOS) for each cart scenario
const { chromium } = require('playwright');

const SITE = 'https://shree-collection-opal.vercel.app';
const CHECKOUT_URL = `${SITE}/checkout.html`;

const orderResults = []; // { name, status, body }

async function runCheckout(page, label) {
    // Intercept /api/orders response
    let orderStatus = null, orderBody = null;
    await page.route('**/api/orders', async route => {
        const resp = await route.fetch();
        orderStatus = resp.status();
        orderBody = await resp.text();
        await route.fulfill({ response: resp });
    });

    // Fill + submit
    await page.waitForSelector('input[id], form', { timeout: 5000 }).catch(() => {});
    await page.fill('#checkoutName', 'Claude Test').catch(() => {});
    await page.fill('#checkoutPhone', '9800000002').catch(() => {});
    await page.fill('#checkoutCity', 'Kathmandu').catch(() => {});
    await page.fill('#checkoutAddress', 'Test Address Verify').catch(() => {});
    const btn = await page.$('#submitOrder');
    if (btn) {
        await btn.click();
        await page.waitForTimeout(5000);
    }

    console.log(`  ${label}: API status=${orderStatus} body=${orderBody?.slice(0, 120)}`);
    orderResults.push({ label, status: orderStatus, body: orderBody });

    // Report errors visible on page
    const pageErrors = await page.$$eval('[class*="error"]', els =>
        els.map(e => e.textContent?.trim()).filter(Boolean).slice(0, 3)
    );
    if (pageErrors.length) console.log(`  Page errors: ${pageErrors.join(' | ')}`);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();

    // --- SCENARIO 1: Single product ---
    console.log('\n=== Scenario 1: Single in-stock product ===');
    {
        const page = await ctx.newPage();
        await page.goto(`${SITE}/catalog.html`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);
        const href = await page.evaluate(() =>
            document.querySelector('a[href*="product.html"]')?.href || null
        );
        if (!href) { console.log('FAIL: No products on catalog'); }
        else {
            await page.goto(href, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(1000);
            const btn = await page.$('#addToCartBtn');
            if (btn) await btn.click();
            await page.waitForTimeout(1000);
            await page.goto(CHECKOUT_URL, { waitUntil: 'networkidle', timeout: 15000 });
            await runCheckout(page, '1-product');
        }
        await page.close();
    }

    // --- SCENARIO 2: Two different products ---
    console.log('\n=== Scenario 2: Two different in-stock products ===');
    {
        const page = await ctx.newPage();
        await page.goto(`${SITE}/catalog.html`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);
        const links = await page.$$eval('a[href*="product.html"]', els => els.slice(0, 2).map(e => e.href));
        for (const link of links) {
            await page.goto(link, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(500);
            const btn = await page.$('#addToCartBtn');
            if (btn) await btn.click();
            await page.waitForTimeout(500);
        }
        const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]'));
        console.log('  Cart items:', cart.map(c => `id=${c.id} color=${c.color} size=${c.size}`).join(' | '));
        await page.goto(CHECKOUT_URL, { waitUntil: 'networkidle', timeout: 15000 });
        await runCheckout(page, '2-products');
        await page.close();
    }

    // --- SCENARIO 3: Three different products ---
    console.log('\n=== Scenario 3: Three different in-stock products ===');
    {
        const page = await ctx.newPage();
        await page.goto(`${SITE}/catalog.html`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);
        const links = await page.$$eval('a[href*="product.html"]', els => els.slice(0, 3).map(e => e.href));
        for (const link of links) {
            await page.goto(link, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(500);
            const btn = await page.$('#addToCartBtn');
            if (btn) await btn.click();
            await page.waitForTimeout(500);
        }
        const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('shree_collection_cart') || '[]'));
        console.log('  Cart items:', cart.map(c => `id=${c.id} color=${c.color} size=${c.size}`).join(' | '));
        await page.goto(CHECKOUT_URL, { waitUntil: 'networkidle', timeout: 15000 });
        await runCheckout(page, '3-products');
        await page.close();
    }

    await ctx.close();
    await browser.close();

    // --- SUMMARY ---
    console.log('\n=== SUMMARY ===');
    for (const r of orderResults) {
        const pass = r.status === 200;
        console.log(`${pass ? 'PASS' : 'FAIL'} [${r.status}] ${r.label}`);
        if (!pass) console.log(`       Body: ${r.body?.slice(0, 200)}`);
    }
    const allPass = orderResults.every(r => r.status === 200);
    console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAILURES — see above'}`);
    process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
