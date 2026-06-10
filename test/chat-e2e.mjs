import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file:///Users/numpolpoldongnok/Documents/GitHub/LocalWork/WebBeam/index.html';
const log = (...a) => console.log(...a);
const launch = (p) => puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 60000,
  userDataDir: '/tmp/webbeam-test/' + p, args: ['--no-sandbox','--no-first-run','--no-default-browser-check'] });
const click = (pg, s) => pg.evaluate(x => document.querySelector(x).click(), s);
const setVal = (pg, s, v) => pg.evaluate((x, val) => { document.querySelector(x).value = val; }, s, v);
const getVal = (pg, s) => pg.evaluate(x => document.querySelector(x).value, s);

const A = await launch('cA'), B = await launch('cB');
let fail = false;
try {
  const pa = await A.newPage(), pb = await B.newPage();
  for (const [p, w] of [[pa,'A'],[pb,'B']]) p.on('pageerror', e => { console.log(w+' pageerror:', e.message); fail = true; });
  await pa.goto(URL); await pb.goto(URL);
  // ตั้งชื่อ
  await setVal(pa, '#myName', 'Alice'); await pa.evaluate(()=>$('#myName')?.dispatchEvent(new Event('input')));
  await pa.evaluate(() => { document.getElementById('myName').value='Alice'; document.getElementById('myName').dispatchEvent(new Event('input')); });
  await pb.evaluate(() => { document.getElementById('myName').value='Bob'; document.getElementById('myName').dispatchEvent(new Event('input')); });
  log('✓ โหลด 2 หน้า + ตั้งชื่อ');

  // handshake
  await click(pa, '#btnCreateOffer');
  await pa.waitForFunction(() => document.getElementById('offerOut').value.length > 0, { timeout: 10000 });
  const offer = await getVal(pa, '#offerOut');
  await click(pb, '#roleSeg button[data-role="b"]');
  await setVal(pb, '#offerIn', offer);
  await click(pb, '#btnCreateAnswer');
  await pb.waitForFunction(() => document.getElementById('answerOut').value.length > 0, { timeout: 10000 });
  const answer = await getVal(pb, '#answerOut');
  await setVal(pa, '#answerIn', answer);
  await click(pa, '#btnAcceptAnswer');
  await Promise.all([
    pa.waitForFunction(() => typeof channel!=='undefined' && channel && channel.readyState==='open', {timeout:20000}),
    pb.waitForFunction(() => typeof channel!=='undefined' && channel && channel.readyState==='open', {timeout:20000}),
  ]);
  log('✓ เชื่อมต่อ + data channel เปิด');

  // A ส่งข้อความ chat
  await pa.evaluate(() => { const i=document.getElementById('input'); i.value='สวัสดี CHATMARK_123'; sendText(); });
  // A ส่ง source file (โค้ด)
  const SRC = 'struct Greeter {\n  let name: String\n  func hi() -> String { "Hi \\(name)" }\n}\n// MARKER_SWIFT_42';
  await pa.evaluate((src) => { queueFiles([new File([src], 'hello.swift', { type: 'text/plain' })]); }, SRC);
  log('✓ A ส่งข้อความ + ไฟล์ hello.swift');

  // B ต้องเห็นทั้งคู่
  await pb.waitForFunction(() => {
    const t = document.getElementById('chat').innerText;
    return t.includes('CHATMARK_123') && t.includes('hello.swift') && t.includes('MARKER_SWIFT_42');
  }, { timeout: 15000 });
  log('✓ B ได้รับข้อความ + เนื้อหาไฟล์ source ครบ (โชว์ inline)');

  // ชื่อผู้ส่งโชว์ถูก (Alice)
  const bShowsAlice = await pb.evaluate(() => document.getElementById('chat').innerText.includes('Alice'));
  log('✓ B เห็นชื่อผู้ส่ง "Alice": ' + bShowsAlice);

  // history persist ใน B
  const hist = await pb.evaluate(() => JSON.parse(localStorage.getItem('webbeam.history') || '[]'));
  log('✓ history ฝั่ง B: ' + hist.length + ' รายการ (kinds: ' + hist.map(h=>h.kind).join(',') + ')');
  if (hist.length < 2) { console.log('❌ history ไม่ครบ'); fail = true; }

  // reload B → ประวัติต้องกลับมา
  await pb.goto(URL);
  const afterReload = await pb.evaluate(() => document.getElementById('chat').innerText);
  const ok = afterReload.includes('CHATMARK_123') && afterReload.includes('hello.swift') && afterReload.includes('MARKER_SWIFT_42');
  log('✓ หลัง reload B ประวัติกลับมาครบ: ' + ok);
  if (!ok) fail = true;

  log(fail ? '\n❌ มีข้อผิดพลาด' : '\n✅ PASS: chat + ส่ง source file inline + history persist + reload ครบ');
} catch (e) { console.log('error:', e.message); fail = true; }
finally { await A.close(); await B.close(); process.exitCode = fail ? 1 : 0; }
