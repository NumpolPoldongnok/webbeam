import { spawn } from 'node:child_process';
const PORT = 8799;
const proc = spawn('node', [new URL('../broker.mjs', import.meta.url).pathname], { env: { ...process.env, PORT } });
await new Promise(r => setTimeout(r, 600));
const B = 'http://localhost:' + PORT;
const post = (p, b) => fetch(B + p, { method: 'POST', body: b });
const get = (p) => fetch(B + p).then(async r => ({ status: r.status, body: r.status === 204 ? null : await r.text() }));
let fails = 0; const chk = (c, m) => { console.log((c ? '  ✓ ' : '  ❌ ') + m); if (!c) fails++; };
try {
  chk((await get('/ping')).body === 'ok', 'ping ตอบ ok');
  chk((await get('/offer')).status === 204, 'ยังไม่มี offer → 204');
  // A โพสต์ offer
  await post('/offer', 'OFFER-A');
  chk((await get('/offer')).body === 'OFFER-A', 'ดึง offer ได้ตรง');
  chk((await get('/answer')).status === 204, 'โพสต์ offer ใหม่ → ล้าง answer เก่า');
  // B โพสต์ answer
  await post('/answer', 'ANSWER-B');
  chk((await get('/answer')).body === 'ANSWER-B', 'ดึง answer ได้ตรง');
  // host re-offer (reconnect) → answer ถูกล้าง
  await post('/offer', 'OFFER-A2');
  chk((await get('/offer')).body === 'OFFER-A2', 'offer ใหม่ทับของเก่า (reconnect)');
  chk((await get('/answer')).status === 204, 'offer ใหม่ล้าง answer → join จะตอบใหม่');
  // reset
  await post('/reset', '');
  chk((await get('/offer')).status === 204, 'reset ล้าง offer');
} catch (e) { console.log('error', e.message); fails++; }
finally { proc.kill(); }
console.log(fails ? '\n❌ FAIL ' + fails : '\n✅ broker PASS ทั้งหมด');
process.exit(fails ? 1 : 0);
