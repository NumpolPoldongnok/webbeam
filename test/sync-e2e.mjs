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

const A = await launch('sA'), B = await launch('sB');
let fail = false;
const chk = (cond, msg) => { if (cond) log('  ✓ ' + msg); else { log('  ❌ ' + msg); fail = true; } };
try {
  const pa = await A.newPage(), pb = await B.newPage();
  for (const [p, w] of [[pa,'A'],[pb,'B']]) p.on('pageerror', e => { console.log(w+' pageerror:', e.message); fail = true; });
  await pa.goto(URL); await pb.goto(URL);
  await pa.evaluate(() => { myName='MacA'; });  // ชื่อใช้ใน conflict naming ผ่าน hello/sender
  await pb.evaluate(() => { myName='MacB'; });
  await setVal(pa, '#myName', 'MacA'); await pa.evaluate(()=>document.getElementById('myName').dispatchEvent(new Event('input')));
  await setVal(pb, '#myName', 'MacB'); await pb.evaluate(()=>document.getElementById('myName').dispatchEvent(new Event('input')));

  // handshake
  await click(pa, '#btnCreateOffer');
  await pa.waitForFunction(() => document.getElementById('offerOut').value.length > 0, { timeout: 10000 });
  const offer = await getVal(pa, '#offerOut');
  await click(pb, '#roleSeg button[data-role="b"]');
  await setVal(pb, '#offerIn', offer); await click(pb, '#btnCreateAnswer');
  await pb.waitForFunction(() => document.getElementById('answerOut').value.length > 0, { timeout: 10000 });
  await setVal(pa, '#answerIn', await getVal(pb, '#answerOut')); await click(pa, '#btnAcceptAnswer');
  await Promise.all([pa.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000}), pb.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000})]);
  log('✓ เชื่อมต่อแล้ว');

  // ปิด auto-sync เพื่อคุมจังหวะเอง
  await pa.evaluate(()=>{ document.getElementById('autoSync').checked=false; document.getElementById('autoSync').dispatchEvent(new Event('change')); });
  await pb.evaluate(()=>{ document.getElementById('autoSync').checked=false; document.getElementById('autoSync').dispatchEvent(new Event('change')); });

  async function settle(rounds=8, gap=350) {
    for (let i=0;i<rounds;i++){ await Promise.all([pa.evaluate(()=>SYNC.syncNow()), pb.evaluate(()=>SYNC.syncNow())]); await wait(gap); }
  }
  const dumpA = () => pa.evaluate(()=>SYNC.dump());
  const dumpB = () => pb.evaluate(()=>SYNC.dump());
  const statsAll = async () => ({ a: await pa.evaluate(()=>SYNC.stats()), b: await pb.evaluate(()=>SYNC.stats()) });

  // ===== Phase 1: เพิ่มไฟล์สองทาง + ไฟล์เหมือนกันไม่ต้องส่ง =====
  log('\n[Phase 1] เพิ่มไฟล์สองทาง');
  await pa.evaluate(()=>SYNC.initMem({ 'a.txt':'AAA', 'common.txt':'v1', 'sub/x.js':'console.log(1)' }, 'mem'));
  await pb.evaluate(()=>SYNC.initMem({ 'b.txt':'BBB', 'common.txt':'v1' }, 'mem'));
  await settle();
  let da = await dumpA(), db = await dumpB();
  chk(db['a.txt']==='AAA', 'B ได้ a.txt จาก A');
  chk(db['sub/x.js']==='console.log(1)', 'B ได้ไฟล์ใน subfolder');
  chk(da['b.txt']==='BBB', 'A ได้ b.txt จาก B');
  chk(da['common.txt']==='v1' && db['common.txt']==='v1', 'common.txt ตรงกัน (ไม่ต้องส่งซ้ำ)');

  // ===== Phase 2: อัปเดตไฟล์ฝั่ง A =====
  log('\n[Phase 2] A อัปเดต common.txt → v2');
  await pa.evaluate(()=>SYNC.put('common.txt','v2'));
  await settle();
  db = await dumpB();
  chk(db['common.txt']==='v2', 'B ได้ common.txt เวอร์ชันใหม่ (v2)');

  // ===== Phase 3: conflict (แก้ทั้งสองฝั่ง) =====
  log('\n[Phase 3] แก้ common.txt ทั้งสองฝั่ง (conflict)');
  await pa.evaluate(()=>SYNC.put('common.txt','A-EDIT'));
  await pb.evaluate(()=>SYNC.put('common.txt','B-EDIT'));
  await settle(10);
  da = await dumpA(); db = await dumpB();
  chk(da['common.txt']==='A-EDIT', 'A: common.txt ของตัวเองไม่ถูกทับ (A-EDIT)');
  chk(db['common.txt']==='B-EDIT', 'B: common.txt ของตัวเองไม่ถูกทับ (B-EDIT)');
  const aConf = Object.entries(da).find(([k,v])=>/common\.conflict-/.test(k) && v==='B-EDIT');
  const bConf = Object.entries(db).find(([k,v])=>/common\.conflict-/.test(k) && v==='A-EDIT');
  chk(!!aConf, 'A เก็บข้อมูลของ B ไว้เป็น conflict file (' + (aConf?aConf[0]:'ไม่พบ') + ')');
  chk(!!bConf, 'B เก็บข้อมูลของ A ไว้เป็น conflict file (' + (bConf?bConf[0]:'ไม่พบ') + ')');

  // ===== Phase 4: เสถียร ไม่ ping-pong =====
  log('\n[Phase 4] เช็คเสถียร (ไม่ส่งวนไม่จบ)');
  await settle(6);
  const s1 = await statsAll();
  await settle(6);
  const s2 = await statsAll();
  const deltaA = (s2.a.up+s2.a.down)-(s1.a.up+s1.a.down);
  const deltaB = (s2.b.up+s2.b.down)-(s1.b.up+s1.b.down);
  log('  transfer delta หลังนิ่งแล้ว: A=' + deltaA + ' B=' + deltaB);
  chk(deltaA===0 && deltaB===0, 'ไม่มีการส่งซ้ำหลัง converge (ไม่ ping-pong)');

  // ===== Phase 5: regression — เครื่องว่างต่อกับเครื่องที่ lastSync ค้างอยู่ =====
  log('\n[Phase 5] เครื่องว่างเปล่าต่อเครื่องที่เคย sync (regression บั๊กที่ผู้ใช้เจอ)');
  await pb.evaluate(()=>SYNC.initMem({}, 'mem2'));   // B โฟลเดอร์ใหม่ ว่างเปล่า
  await settle(10);
  db = await dumpB();
  chk(Object.keys(db).length > 0, 'B (ว่างเปล่า) ได้รับไฟล์จาก A แม้ A มี lastSync ค้าง (' + Object.keys(db).length + ' ไฟล์)');
  chk(db['a.txt']==='AAA', 'B ได้ a.txt');
  chk(db['sub/x.js']==='console.log(1)', 'B ได้ subfolder');

  log('\n' + (fail ? '❌ มีข้อผิดพลาด' : '✅ PASS ทุกเคส: เพิ่มสองทาง + อัปเดต + conflict + ไม่ ping-pong + เครื่องว่างได้ไฟล์ครบ'));
} catch (e) { console.log('error:', e.message, e.stack); fail = true; }
finally { await A.close(); await B.close(); process.exitCode = fail ? 1 : 0; }
