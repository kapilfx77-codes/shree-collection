const { chromium } = require('playwright');

async function measure(url, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.grantPermissions([]);
  const page = await context.newPage();

  // Capture all network responses with timing
  const requests = [];
  page.on('request', r => requests.push({ url: r.url(), type: r.resourceType(), method: r.method() }));

  const start = Date.now();
  let responseStatus = null;
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    responseStatus = res ? res.status() : null;
  } catch (e) {
    responseStatus = 'TIMEOUT';
  }
  const loadTime = Date.now() - start;

  // Measure network timing more precisely by inspecting performance entries
  const perf = await page.evaluate(() => {
    const entries = performance.getEntriesByType('navigation');
    const resources = performance.getEntriesByType('resource');
    return {
      navigation: entries.map(e => ({ name: e.name, startTime: Math.round(e.startTime), duration: Math.round(e.duration), entryType: e.entryType })),
      resources: resources.map(e => ({ name: e.name, startTime: Math.round(e.startTime), duration: Math.round(e.duration), initiatorType: e.initiatorType })).slice(0, 30)
    };
  });

  console.log(`=== ${label} (${url}) ===`);
  console.log('Status:', responseStatus);
  console.log('Total load time:', loadTime + 'ms');

  // Slowest resource requests
  const sortedResources = perf.resources.sort((a, b) => b.duration - a.duration).slice(0, 10);
  console.log('Top 10 slowest resources (ms):');
  sortedResources.forEach(r => {
    console.log('  ' + Math.round(r.duration) + 'ms - ' + r.name.substring(0, 140) + (r.initiatorType ? ' (' + r.initiatorType + ')' : ''));
  });

  // Count Supabase-related calls
  const supabaseCalls = requests.filter(r => r.url.includes('supabase') || r.url.includes('postgrest'));
  console.log('Supabase/API requests count:', supabaseCalls.length);
  supabaseCalls.forEach(r => console.log('  ' + r.method + ' ' + r.url.substring(0, 180)));

  await browser.close();
  return { label, url, loadTime, status: responseStatus, resources: sortedResources, supabaseCalls };
}

(async () => {
  const results = [];
  results.push(await measure('https://shree-collection-opal.vercel.app/', 'HOMEPAGE'));
  results.push(await measure('https://shree-collection-opal.vercel.app/catalog.html', 'CATALOG'));
  // Product page (use product.html?id=1; DB may have products)
  results.push(await measure('https://shree-collection-opal.vercel.app/product.html?id=1', 'PRODUCT'));
  results.push(await measure('https://shree-collection-opal.vercel.app/contact.html', 'CONTACT'));

  console.log('\n=== SUMMARY ===');
  results.forEach(r => console.log(r.label + ': ' + r.loadTime + 'ms (status: ' + r.status + ')'));
})();
