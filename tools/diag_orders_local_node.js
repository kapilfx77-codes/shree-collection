// Test the EXACT flow that orders.js uses, but from local Node
// This bypasses Vercel entirely
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
  'Prefer': 'return=representation',
};

async function http(method, path, body) {
  const r = await fetch(URL + '/rest/v1/' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, text: await r.text() };
}

async function main() {
  // Set stock to 5
  await http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', { quantity: 5, reserved: 0 });
  let r = await http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity');
  console.log('stock before:', r.text);

  // 10 concurrent, replicating Vercel orders.js EXACTLY
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => {
      // Step 1: Insert order row
      const orderId = 'TEST-' + Date.now() + '-' + i;
      return http('POST', 'orders', {
        order_id: orderId,
        name: 'LocalTest',
        phone: '98' + Math.random().toString().slice(2, 10) + i.toString(),
        city: 'KTM',
        address: 'X',
        items: [{ id: 1, color: 'Red', size: 'M', quantity: 1 }],
        payment_method: 'esewa',
        payment_status: 'pending',
        total: 100,
      }).then(orderRes => {
        // Step 2: Call RPC (this is what fails)
        return fetch(URL + '/rest/v1/rpc/decrement_inventory', {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_product_id: 1, p_color: 'Red', p_size: 'M', p_qty: 1 }),
        }).then(r => r.text()).then(text => ({ i, order_status: orderRes.status, dec_text: text }));
      });
    })
  );
  console.log(`Done in ${Date.now() - t0}ms`);
  for (const r of results) console.log(`  [${r.i}] order=${r.order_status} dec=${r.dec_text.slice(0, 80)}`);

  r = await http('GET', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M&select=quantity');
  console.log('final stock:', r.text);

  // Reset
  await http('PATCH', 'inventory?product_id=eq.1&color=eq.Red&size=eq.M', { quantity: 100, reserved: 0 });
}
main().catch(e => console.error(e));
