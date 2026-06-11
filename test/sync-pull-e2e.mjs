import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file:///Users/numpolpoldongnok/Documents/GitHub/LocalWork/WebBeam/sync.html';
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const launch = (p) => puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 60000,
  userDataDir: '/tmp/webbeam-test/' + p, args: ['--no-sandbox','--no-first-run','--no-default-browser-check'] });
const click = (pg, s) => pg.evaluate(x => document.querySelector(x).click(), s);
const setVal = (pg, s, v) => pg.evaluate((x, val) => { document.querySelector(x).value = val; }, s, v);
const getVal = (pg, s) => pg.evaluate(x => document.querySelector(x).value, s);

const A = await launch('plA'), B = await launch('plB');
let fail = false;
const chk = (c, m) => { if (c) log('  ✓ ' + m); else { log('  ❌ ' + m); fail = true; } };
try {
  const pa = await A.newPage(), pb = await B.newPage();
  for (const [p, w] of [[pa,'A'],[pb,'B']]) p.on('pageerror', e => { console.log(w+' pageerror:', e.message); fail = true; });
  await pa.goto(URL); await pb.goto(URL);

  // เชื่อมแบบ offline (แลกรหัสเอง) — ไม่พึ่ง broker
  await click(pa, '#btnCreateOffer');
  await pa.waitForFunction(() => document.getElementById('offerOut').value.length > 0, { timeout: 10000 });
  const offer = await getVal(pa, '#offerOut');
  await click(pb, '#roleSeg button[data-role="b"]');
  await setVal(pb, '#offerIn', offer); await click(pb, '#btnCreateAnswer');
  await pb.waitForFunction(() => document.getElementById('answerOut').value.length > 0, { timeout: 10000 });
  await setVal(pa, '#answerIn', await getVal(pb, '#answerOut')); await click(pa, '#btnAcceptAnswer');
  await Promise.all([pa.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000}), pb.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000})]);
  log('✓ เชื่อมต่อแล้ว');

  // A = ต้นฉบับ (ไฟล์เยอะ), B = มีไฟล์เก่า/ต่าง + ไฟล์ที่ A ไม่มี
  await pa.evaluate(()=>SYNC.initMem({ 'a.txt':'A-NEW', 'b.txt':'BBB', 'sub/x.js':'console.log(1)' }));
  await pb.evaluate(()=>SYNC.initMem({ 'a.txt':'B-STALE', 'onlyB.txt':'KEEP-ME' }));

  // B กด "ดึงทั้งหมดจาก A มาแทนที่"
  log('B กดดึงทั้งหมดจาก A…');
  await pb.evaluate(()=>SYNC.pullAll());
  // รอจน B ไม่ busy + ได้ไฟล์ครบ
  await pb.waitForFunction(() => { const d = SYNC.dump(); return d && d['a.txt']==='A-NEW' && d['b.txt'] && d['sub/x.js']; }, { timeout: 15000 });
  await wait(500);
  const db = await pb.evaluate(()=>SYNC.dump());
  log('  B หลังดึง: ' + JSON.stringify(db));

  chk(db['a.txt']==='A-NEW', 'a.txt ถูกเขียนทับด้วยของ A (A-NEW)');
  chk(db['b.txt']==='BBB', 'ได้ b.txt จาก A');
  chk(db['sub/x.js']==='console.log(1)', 'ได้ไฟล์ใน subfolder จาก A');
  chk(db['onlyB.txt']==='KEEP-ME', 'ไฟล์ที่ A ไม่มี (onlyB.txt) ไม่ถูกลบ — ยังอยู่');

  // ทิศทางเดียว: A ไม่ควรได้ไฟล์ของ B (เพราะ B เป็นฝ่ายดึง)
  const da = await pa.evaluate(()=>SYNC.dump());
  chk(!da['onlyB.txt'], 'ทางเดียว: A ไม่ได้ไฟล์ของ B (A ไม่เปลี่ยน)');

  log('\n' + (fail ? '❌ มีข้อผิดพลาด' : '✅ PASS: ดึงทั้งหมดมาแทนที่ (ทางเดียว, เขียนทับ, ไม่ลบไฟล์ที่อีกฝั่งไม่มี)'));
} catch (e) { console.log('error:', e.message); fail = true; }
finally { await A.close(); await B.close(); process.exitCode = fail ? 1 : 0; }
