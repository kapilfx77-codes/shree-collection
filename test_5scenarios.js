// 5-scenario test for inventory fix
(async () => {
  async function postOrder(label, items) {
    const body = { name: 'Test', phone: '9800000002', city: 'KTM', address: 'Test', paymentMethod: 'cod', items, total: 9999 };
    const r = await fetch('https://shree-collection-opal.vercel.app/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    console.log(`  ${label}: status=${r.status} ${parsed.error || 'OK'}`);
    return { status: r.status, body: parsed };
  }

  console.log('T1 single in-stock (p92 Red FS qty=14):');
  const t1 = await postOrder('T1', [{ id: 92, color: 'Red', size: 'Free Size', quantity: 1, price: 5000 }]);

  console.log('T2 two in-stock (p92 Red FS + p40 Green FS):');
  const t2 = await postOrder('T2', [
    { id: 92, color: 'Red', size: 'Free Size', quantity: 1, price: 5000 },
    { id: 40, color: 'Green', size: 'Free Size', quantity: 1, price: 4000 }
  ]);

  console.log('T3 three in-stock (p92 + p40 + p39 Red M qty=25):');
  const t3 = await postOrder('T3', [
    { id: 92, color: 'Red', size: 'Free Size', quantity: 1, price: 5000 },
    { id: 40, color: 'Green', size: 'Free Size', quantity: 1, price: 4000 },
    { id: 39, color: 'Red', size: 'M', quantity: 1, price: 3000 }
  ]);

  console.log('T4 genuine OOS (p95 Red S qty=0):');
  const t4 = await postOrder('T4', [{ id: 95, color: 'Red', size: 'S', quantity: 1, price: 5000 }]);

  console.log('T5 insufficient qty (p92 Red FS has qty=14, request 999):');
  const t5 = await postOrder('T5', [{ id: 92, color: 'Red', size: 'Free Size', quantity: 999, price: 5000 }]);

  console.log('\n=== RESULTS ===');
  // T1 should succeed (201)
  const T1 = t1.status === 201 || t1.status === 200;
  // T2 should succeed
  const T2 = t2.status === 201 || t2.status === 200;
  // T3 should succeed
  const T3 = t3.status === 201 || t3.status === 200;
  // T4 should be 409 with out_of_stock
  const T4 = t4.status === 409 && (t4.body.code === 'out_of_stock' || /out of stock/i.test(t4.body.error || ''));
  // T5 should be 409 (insufficient_stock or out_of_stock; with quantity cap may be 400)
  const T5 = t5.status === 409 || t5.status === 400;

  console.log(`T1 single: ${T1 ? 'PASS' : 'FAIL'}`);
  console.log(`T2 two:    ${T2 ? 'PASS' : 'FAIL'}`);
  console.log(`T3 three:  ${T3 ? 'PASS' : 'FAIL'}`);
  console.log(`T4 OOS:    ${T4 ? 'PASS' : 'FAIL'}`);
  console.log(`T5 insuf:  ${T5 ? 'PASS' : 'FAIL'}`);
})();
