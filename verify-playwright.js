const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results = [];

  // 1. Homepage
  try {
    const res = await page.goto('https://shree-collection-opal.vercel.app/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    results.push('Homepage: ' + res.status());
  } catch (e) { results.push('Homepage: ERROR'); }

  // 2. Catalog
  try {
    const res = await page.goto('https://shree-collection-opal.vercel.app/catalog.html', { waitUntil: 'domcontentloaded', timeout: 15000 });
    results.push('Catalog: ' + res.status());
  } catch (e) { results.push('Catalog: ERROR'); }

  // 3. Contact
  try {
    const res = await page.goto('https://shree-collection-opal.vercel.app/contact.html', { waitUntil: 'domcontentloaded', timeout: 15000 });
    results.push('Contact: ' + res.status());
  } catch (e) { results.push('Contact: ERROR'); }

  // 4. Invalid URL -> 404
  try {
    const res = await page.goto('https://shree-collection-opal.vercel.app/nonexistent-page-test-404', { waitUntil: 'domcontentloaded', timeout: 15000 });
    results.push('404 page: ' + res.status());
  } catch (e) { results.push('404 page: ERROR'); }

  // 5. Check 404 content
  try {
    await page.goto('https://shree-collection-opal.vercel.app/nonexistent-page-test-404', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title();
    const body = await page.textContent('body');
    results.push('404 title: ' + title);
    results.push('404 has link: ' + body.includes('Page Not Found'));
  } catch (e) { results.push('404 check: ERROR'); }

  console.log(results.join('\n'));
  await browser.close();
})();
