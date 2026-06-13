// Headless test: รัน script จริงของ sync.html ใน 2 vm context (A,B), ต่อ loopback "data channel"
// แล้วทดสอบ: แชตข้อความ, ส่งไฟล์ใน chat (text/binary/image), encSDP/decSDP roundtrip, mungeSDP
import vm from 'node:vm';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../sync.html', import.meta.url), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/<\/?script>/g, '');

function makeEl(id) {
  const el = {
    id, value: '', textContent: '', _html: '', disabled: false, open: false, checked: false,
    style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0, src: '', alt: '', loading: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    addEventListener(){}, removeEventListener(){}, remove(){}, select(){}, focus(){}, click(){},
    appendChild(c){ this.children.push(c); return c; },
    prepend(c){ this.children.unshift(c); },
    set innerHTML(h){ this._html = h; if (!h) this.children = []; },
    get innerHTML(){ return this._html; },
    get innerText(){ const f = e => (e.textContent || '') + e.children.map(f).join(' '); return f(this); },
    get firstChild(){ return this.children[0]; },
    get lastChild(){ return this.children[this.children.length - 1]; },
    querySelector(){ return makeEl('q'); }, querySelectorAll(){ return []; },
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
    document: { getElementById: $, createElement: () => makeEl('new'), querySelectorAll: () => [], addEventListener(){} },
    navigator: {}, alert: (m) => console.log('ALERT:', m), confirm: () => true,
    addEventListener(){}, removeEventListener(){},
    Date, JSON, Math, Promise, RegExp, Object, Array, Map, Set, Number, String, Uint8Array, ArrayBuffer, DataView, isNaN,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  try { vm.runInContext(js, ctx, { filename: name + '.js' }); } catch (e) { console.log('SCRIPT ERR', name, e.message); throw e; }
  return { ctx, $, run: (code) => vm.runInContext(code, ctx) };
}

const A = makeCtx('A'), B = makeCtx('B');
const cA = { readyState:'open', binaryType:'', bufferedAmount:0, bufferedAmountLowThreshold:0, addEventListener(){}, removeEventListener(){}, send: d => queueMicrotask(() => B.run('channel.onmessage')({ data: d })) };
const cB = { readyState:'open', binaryType:'', bufferedAmount:0, bufferedAmountLowThreshold:0, addEventListener(){}, removeEventListener(){}, send: d => queueMicrotask(() => A.run('channel.onmessage')({ data: d })) };
A.ctx.__ch = cA; B.ctx.__ch = cB;
A.run('setupChannel(__ch)'); B.run('setupChannel(__ch)');
A.run('channel.onopen()'); B.run('channel.onopen()');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const chk = (c, m) => { console.log((c ? '  ✓ ' : '  ❌ ') + m); if (!c) fails++; };
const waitB = async (sub) => { for (let i = 0; i < 80; i++) { await sleep(40); if (B.run('WB.chatText()').includes(sub)) return true; } return false; };
await sleep(50);

// ---- test 1: แชตข้อความ ----
console.log('test 1: แชตข้อความ A → B');
A.run('WB.sendChat("สวัสดี B จาก A")');
chk(await waitB('สวัสดี B จาก A'), 'B เห็นข้อความจาก A');

// ---- test 2: ส่งไฟล์ text ใน chat ----
console.log('test 2: ส่งไฟล์ text ใน chat');
await A.run('WB.sendChatFile("note.txt", "hello chat file")');
chk(await waitB('note.txt'), 'B รับไฟล์ text (note.txt)');
chk(B.run('WB.chatText()').includes('hello chat file'), 'B เห็นเนื้อหาไฟล์ text (แสดงเป็นโค้ด)');

// ---- test 3: ส่งไฟล์ binary ใน chat ----
console.log('test 3: ส่งไฟล์ binary ใน chat');
let binErr = null;
try { await A.run('sendChatFile(new File([new Uint8Array([1,2,3,4,5,250,251,252])], "data.bin", { type: "application/octet-stream" }))'); }
catch (e) { binErr = e.message; }
chk(!binErr, 'ส่ง binary ไม่ throw (' + (binErr || 'ok') + ')');
chk(await waitB('data.bin'), 'B รับไฟล์ binary (data.bin)');
chk(B.run('WB.chatText()').includes('8 B'), 'แสดงขนาดไฟล์ด้วย fmtBytes (8 B)');

// ---- test 4: ส่งรูปภาพใน chat (พรีวิว) ----
console.log('test 4: ส่งรูปภาพใน chat');
let imgErr = null;
try { await A.run('sendChatFile(new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])], "shot.png", { type: "image/png" }))'); }
catch (e) { imgErr = e.message; }
chk(!imgErr, 'ส่งรูปไม่ throw (' + (imgErr || 'ok') + ')');
chk(await waitB('shot.png'), 'B รับรูป (shot.png) แสดงเป็นพรีวิว');

// ---- test 5: encSDP/decSDP roundtrip + mungeSDP ----
console.log('test 5: รหัสเชื่อมต่อแบบย่อ + แทน mDNS ด้วย IP');
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
