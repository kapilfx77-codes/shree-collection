// Inspect the actual function body in Supabase
const { exec } = require('child_process');

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

async function rpc(name, args) {
  const r = await fetch(URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  return { status: r.status, text: await r.text() };
}

async function main() {
  // Try a direct query to get function info — but PostgREST doesn't expose pg_proc
  // Instead, we test behavior: send 2 concurrent calls, see what happens
  await fetch(URL + '/rest/v1/inventory?product_id=eq.1&color=eq.Red&size=eq.M', {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ quantity: 5, reserved: 0 }),
  });

  const r1 = rpc('decrement_inventory', { p_product_id: 1, p_color: 'Red', p_size: 'M', p_qty: 1 });
  const r2 = rpc('decrement_inventory', { p_product_id: 1, p_color: 'Red', p_size: 'M', p_qty: 1 });
  const results = await Promise.all([r1, r2]);
  for (const r of results) console.log(r.status, r.text);

  // Reset
  await fetch(URL + '/rest/v1/inventory?product_id=eq.1&color=eq.Red&size=eq.M', {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ quantity: 100, reserved: 0 }),
  });
}
main().catch(console.error);
