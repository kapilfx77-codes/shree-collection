// Mimics the EXACT behavior of the Vercel function calling Supabase
const { exec } = require('child_process');
const fs = require('fs');

const KEY = fs.readFileSync('.env.local', 'utf8')
  .split('\n')
  .find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='))
  .split('=')[1]
  .trim();
const URL = 'https://xztfoauqecnmznszghcj.supabase.co';

const headers = {
  apikey: KEY,
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function http(method, path, body) {
  const r = await fetch(URL + '/rest/v1/' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, text: t };
}

async function main() {
  // Set stock to 5
  await http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', { quantity: 5, reserved: 0 });
  let r = await http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity');
  console.log('stock:', r.text);

  // 10 concurrent
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      http('POST', 'rpc/decrement_inventory', {
        p_product_id: 1, p_color: 'Red', p_size: 'M', p_qty: 1,
      }).then(r => ({ i, ...r })),
    ),
  );
  console.log(`10 concurrent done in ${Date.now() - t0}ms`);
  let empty = 0, nonempty = 0;
  for (const r of results) {
    const parsed = JSON.parse(r.text);
    if (Array.isArray(parsed) && parsed.length === 0) empty++;
    else { nonempty++; console.log(`  [${r.i}] status=${r.status} body=${r.text}`); }
  }
  console.log(`empty=${empty} nonempty=${nonempty}`);

  r = await http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity');
  console.log('final stock:', r.text);

  // Reset
  await http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', { quantity: 100, reserved: 0 });
  console.log('reset to 100');
}

main().catch(e => { console.error(e); process.exit(1); });
