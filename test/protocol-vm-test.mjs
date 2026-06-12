// Headless protocol test: run sync.html's real script in 2 vm contexts (A,B),
// wire a loopback "data channel", then test: pull-all (bundles+big file),
// incremental skip, one-way, encSDP/decSDP roundtrip, mungeSDP IP replacement.
import vm from 'node:vm';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sync.html', import.meta.url), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/<\/?script>/g, '');

function makeEl(id) {
  const el = {
    id, value: '', textContent: '', _html: '', disabled: false, open: false, checked: false,
    style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0,
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    addEventListener(){}, removeEventListener(){}, remove(){}, select(){}, focus(){}, click(){},
    appendChild(c){ this.children.push(c); return c; },
    prepend(c){ this.children.unshift(c); },
    // ตั้ง innerHTML → สร้าง child element ตามจำนวน top-level tag (พอให้ fm.children[i] ใช้งานได้)
    set innerHTML(html) { this._html = html; this.children = [];
      const re = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*)\/?>/g; let m;
      while ((m = re.exec(html))) { const c = makeEl('h'); c.textContent = (m[3] || '').replace(/<[^>]+>/g, ''); this.children.push(c); } },
    get innerHTML(){ return this._html; },
    get innerText(){ const f = e => (e.textContent || '') + e.children.map(f).join(' '); return f(this); },
    get firstChild(){ return this.children[0]; },
    get lastChild(){ return this.children[this.children.length - 1]; },
    querySelector(){ return makeEl('q'); },
    querySelectorAll(){ return []; },
  };
  return el;
}
function makeCtx(name) {
  const els = new Map();
  const $ = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const storage = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    performance, crypto, Blob, File, TextEncoder, TextDecoder, Response,
    CompressionStream, DecompressionStream,
    URL: Object.assign(Object.create(URL), { createObjectURL: () => 'blob:stub', revokeObjectURL(){} }),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k,v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    document: {
      getElementById: $, createElement: () => makeEl('new'),
      querySelectorAll: () => [], addEventListener(){},
    },
    navigator: {},
    addEventListener(){}, removeEventListener(){},
    Date, JSON, Math, Promise, RegExp, Object, Array, Map, Set, Number, String, Uint8Array, ArrayBuffer,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(js, ctx, { filename: name + '.js' });
  return { ctx, $, run: (code) => vm.runInContext(code, ctx) };
}

const A = makeCtx('A'), B = makeCtx('B');

// loopback channels
function chan(other) {
  return {
    readyState: 'open', binaryType: '', bufferedAmount: 0, bufferedAmountLowThreshold: 0,
    addEventListener(){}, removeEventListener(){},
    send(data) { queueMicrotask(() => other._recv(data)); },
  };
}
const chA = chan(null), chB = chan(null);
chA._recv = null; chB._recv = null;
// A.send -> B.onMessage ; B.send -> A.onMessage
const cA = { ...chA, send: d => queueMicrotask(() => B.run('channel.onmessage')( { data: d } )) };
const cB = { ...chB, send: d => queueMicrotask(() => A.run('channel.onmessage')( { data: d } )) };
A.ctx.__ch = cA; B.ctx.__ch = cB;
A.run('setupChannel(__ch)'); B.run('setupChannel(__ch)');
A.run('channel.onopen()'); B.run('channel.onopen()');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const chk = (c, m) => { console.log((c ? '  ✓ ' : '  ❌ ') + m); if (!c) fails++; };

// ---- test 1: pull with bundles + big file ----
const filesA = {};
for (let i = 0; i < 30; i++) filesA['src/f' + i + '.js'] = 'console.log(' + i + ');//' + 'x'.repeat(50 + i);
A.ctx.__big = 'B'.repeat(600 * 1024); // > SMALL(256KB) -> single-file path
A.run('SYNC.initMem({})');
A.run(`(async () => { const f = ${JSON.stringify(filesA)}; for (const p in f) await SYNC.put(p, f[p]); await SYNC.put('big.bin', __big); })()`);
B.run('SYNC.initMem({ "src/f0.js": "STALE", "onlyB.txt": "KEEP" })');
await sleep(50);

console.log('test 1: ดึงทั้งหมด (ชุดไฟล์เล็ก + ไฟล์ใหญ่เดี่ยว)');
B.run('SYNC.pullAll()');
for (let i = 0; i < 100; i++) { await sleep(100); const d = B.run('SYNC.dump()'); if (d && d['big.bin'] && d['src/f29.js']) break; }
await sleep(300);
const db = B.run('SYNC.dump()');
chk(db['src/f0.js'] === filesA['src/f0.js'], 'ไฟล์ stale ถูกเขียนทับ');
chk(Object.keys(filesA).every(p => db[p] === filesA[p]), 'ไฟล์เล็กครบ 30 ไฟล์ (มาเป็นชุด gzip)');
chk(db['big.bin'] && db['big.bin'].length === 600 * 1024, 'ไฟล์ใหญ่ 600KB ครบ (ส่งเดี่ยว)');
chk(db['onlyB.txt'] === 'KEEP', 'ไฟล์ที่ A ไม่มี ไม่ถูกลบ');
const da = A.run('SYNC.dump()');
chk(!da['onlyB.txt'], 'ทางเดียว: A ไม่เปลี่ยน');
const stB = B.run('SYNC.stats()');
chk(stB.down === 31, 'นับรับเข้า = 31 (' + stB.down + ')');

// ---- test 2: ดึงซ้ำ → คัดลอกทุกไฟล์อีกครั้ง (full copy เสมอ ไม่ใช่ incremental) ----
console.log('test 2: ดึงซ้ำ → ส่งทุกไฟล์อีกครั้ง (full copy)');
const upBefore = A.run('SYNC.stats()').up;
B.run('SYNC.pullAll()');
for (let i = 0; i < 100; i++) { await sleep(50); if (A.run('SYNC.stats()').up >= upBefore + 31) break; }
await sleep(200);
const upAfter = A.run('SYNC.stats()').up;
chk(upAfter === upBefore + 31, 'รอบสอง A ส่งครบ 31 อีกครั้ง (up ' + upBefore + ' → ' + upAfter + ')');

// ---- test 3: แก้ 1 ไฟล์ → ดึงทั้งหมด ได้ไฟล์ที่แก้ ----
console.log('test 3: แก้ไฟล์เดียว → ดึงทั้งหมด ได้ไฟล์ที่แก้');
A.run('SYNC.put("src/f5.js", "CHANGED!")');
await sleep(50);
B.run('SYNC.pullAll()');
for (let i = 0; i < 100; i++) { await sleep(50); if (A.run('SYNC.stats()').up >= upAfter + 31) break; }
await sleep(200);
const db3 = B.run('SYNC.dump()');
chk(db3['src/f5.js'] === 'CHANGED!', 'ได้ไฟล์ที่แก้');
chk(A.run('SYNC.stats()').up === upAfter + 31, 'ส่งครบทั้งหมดอีกครั้ง (' + A.run('SYNC.stats()').up + ')');

// ---- test 4: ดึงแบบ zip ก้อนเดียว (รวม+บีบ → แตกปลายทาง) ----
console.log('test 4: ดึงแบบ zip ก้อนเดียว');
B.$('zipAll').checked = true;
const upZ = A.run('SYNC.stats()').up;
B.run('SYNC.pullAll()');
for (let i = 0; i < 150; i++) { await sleep(50); if (A.run('SYNC.stats()').up >= upZ + 31) break; }
await sleep(300);
const dz = B.run('SYNC.dump()');
chk(Object.keys(filesA).filter(p => p !== 'src/f5.js').every(p => dz[p] === filesA[p]), 'zip: ไฟล์เล็กครบ (แตกจากก้อนเดียว)');
chk(dz['big.bin'] && dz['big.bin'].length === 600 * 1024, 'zip: ไฟล์ใหญ่ 600KB ครบ');
chk(dz['src/f5.js'] === 'CHANGED!', 'zip: ได้ไฟล์ที่แก้ล่าสุด');
chk(A.run('SYNC.stats()').up === upZ + 31, 'zip: นับส่งครบ 31 (' + A.run('SYNC.stats()').up + ')');
B.$('zipAll').checked = false;

// ---- test 5: chat — ส่งไฟล์ใน chat ทั้ง text และ binary ----
console.log('test 5: ส่งไฟล์ใน chat (text + binary)');
await A.run('SYNC.sendChatFile("note.txt", "hello chat file")');
for (let i = 0; i < 60; i++) { await sleep(50); if (B.run('SYNC.chatText()').includes('note.txt')) break; }
chk(B.run('SYNC.chatText()').includes('note.txt'), 'B รับไฟล์ text ใน chat (note.txt)');
let binErr = null;
try { await A.run('sendChatFile(new File([new Uint8Array([1,2,3,4,5,250,251,252])], "pic.bin", { type: "application/octet-stream" }))'); }
catch (e) { binErr = e.message; }
chk(!binErr, 'ส่งไฟล์ binary ไม่ throw (' + (binErr || 'ok') + ')');
for (let i = 0; i < 60; i++) { await sleep(50); if (B.run('SYNC.chatText()').includes('pic.bin')) break; }
chk(B.run('SYNC.chatText()').includes('pic.bin'), 'B รับไฟล์ binary ใน chat (pic.bin)');
chk(B.run('SYNC.chatText()').includes('8 B'), 'แสดงขนาดไฟล์ด้วย fmtBytes (8 B)');

// ---- test 6: encSDP/decSDP roundtrip + mungeSDP ----
console.log('test 6: รหัสเชื่อมต่อแบบย่อ + แทน mDNS ด้วย IP');
const sdpIn = 'v=0\r\na=candidate:123 1 udp 2122 abcd-ef12.local 5000 typ host generation 0\r\na=candidate:124 1 tcp 2121 9999-8888.local 5001 typ host\r\n';
A.ctx.__sdp = sdpIn;
const enc1 = await A.run('encSDP({ type: "offer", sdp: __sdp })');
chk(enc1.startsWith('WB1.'), 'encSDP ใช้ฟอร์แมตย่อ WB1');
chk(enc1.length < Buffer.from(JSON.stringify({type:'offer',sdp:sdpIn})).toString('base64').length, 'สั้นกว่า base64 เดิม');
const dec1 = await A.run(`decSDP(${JSON.stringify(enc1)})`);
chk(dec1.sdp === sdpIn && dec1.type === 'offer', 'decSDP ถอดกลับได้ตรงเป๊ะ');
const oldFmt = Buffer.from(unescape(encodeURIComponent(JSON.stringify({type:'answer',sdp:'x'}))), 'binary').toString('base64');
const dec2 = await A.run(`decSDP(${JSON.stringify(oldFmt)})`);
chk(dec2.type === 'answer', 'ยังอ่านรหัสฟอร์แมตเก่าได้');
A.$('myIP').value = '192.168.1.42';
const mg = A.run('mungeSDP({ type: "offer", sdp: __sdp })');
chk(!/\.local/.test(mg.sdp) && mg.sdp.includes('192.168.1.42 5000') && mg.sdp.includes('192.168.1.42 5001'), 'mungeSDP แทน .local ทั้ง 2 candidate ด้วย IP');
A.$('myIP').value = 'not-an-ip';
chk(/\.local/.test(A.run('mungeSDP({ type: "offer", sdp: __sdp })').sdp), 'IP ไม่ถูกต้อง → ไม่แตะ SDP');

console.log(fails ? `\n❌ FAIL ${fails}` : '\n✅ PASS ทั้งหมด');
process.exit(fails ? 1 : 0);
