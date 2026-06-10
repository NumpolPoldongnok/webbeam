import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file:///Users/numpolpoldongnok/Documents/GitHub/LocalWork/WebBeam/sync.html';
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const launch = (p) => puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 60000,
  userDataDir: '/tmp/webbeam-test/' + p, args: ['--no-sandbox','--no-first-run','--no-default-browser-check'] });

const CODE = 'PJ' + Math.floor(performance.now() % 90000 + 10000);
const A = await launch('pjsA'), B = await launch('pjsB');
let fail = false;
const chk = (c, m) => { if (c) log('  ✓ ' + m); else { log('  ❌ ' + m); fail = true; } };
try {
  const pa = await A.newPage(), pb = await B.newPage();
  for (const [p, w] of [[pa,'A'],[pb,'B']]) p.on('pageerror', e => { console.log(w+' pageerror:', e.message); fail = true; });
  await pa.goto(URL); await pb.goto(URL);
  await pa.evaluate(()=>{ const n=document.getElementById('myName'); n.value='MacA'; n.dispatchEvent(new Event('input')); });
  await pb.evaluate(()=>{ const n=document.getElementById('myName'); n.value='MacB'; n.dispatchEvent(new Event('input')); });

  log('เชื่อมด้วยรหัสห้อง: ' + CODE);
  await pa.evaluate(c => SYNC.connectRoom(c), CODE);
  await wait(500);
  await pb.evaluate(c => SYNC.connectRoom(c), CODE);
  await Promise.all([
    pa.waitForFunction(()=>SYNC.channelOpen(), {timeout:25000}),
    pb.waitForFunction(()=>SYNC.channelOpen(), {timeout:25000}),
  ]);
  log('✓ เชื่อมต่อผ่าน PeerJS broker สำเร็จ (รหัสห้องเดียวกัน auto host/join)');

  // sync ไฟล์
  await pa.evaluate(()=>SYNC.initMem({ 'a.txt':'AAA', 'sub/x.js':'X' }, 'mem'));
  await pb.evaluate(()=>SYNC.initMem({ 'b.txt':'BBB' }, 'mem'));
  for (let i=0;i<8;i++){ await Promise.all([pa.evaluate(()=>SYNC.syncNow()), pb.evaluate(()=>SYNC.syncNow())]); await wait(400); }
  let da = await pa.evaluate(()=>SYNC.dump()), db = await pb.evaluate(()=>SYNC.dump());
  chk(db['a.txt']==='AAA' && db['sub/x.js']==='X', 'B ได้ไฟล์จาก A ผ่าน PeerJS');
  chk(da['b.txt']==='BBB', 'A ได้ไฟล์จาก B ผ่าน PeerJS');

  // ===== auto-reconnect: reload B แล้วต้องต่อใหม่เองโดยไม่ต้อง pair =====
  log('\n[reconnect] reload เครื่อง B (จำลอง refresh)…');
  await pb.reload({ waitUntil: 'load' });
  await pb.evaluate(()=>{ const n=document.getElementById('myName'); n.value='MacB'; n.dispatchEvent(new Event('input')); });
  await pb.waitForFunction(()=>SYNC.channelOpen(), {timeout:25000});
  log('  ✓ B ต่อใหม่อัตโนมัติหลัง reload (ไม่ต้อง pair ใหม่)');

  // sync ต่อได้หลัง reconnect
  await pb.evaluate(()=>SYNC.initMem({ 'c.txt':'CCC' }, 'mem'));
  for (let i=0;i<8;i++){ await Promise.all([pa.evaluate(()=>SYNC.syncNow()), pb.evaluate(()=>SYNC.syncNow())]); await wait(400); }
  da = await pa.evaluate(()=>SYNC.dump());
  chk(da['c.txt']==='CCC', 'หลัง reconnect ยัง sync ได้ (A ได้ c.txt จาก B ที่เพิ่ง reload)');

  log('\n' + (fail ? '❌ มีข้อผิดพลาด' : '✅ PASS: PeerJS รหัสห้อง + sync + auto-reconnect หลัง refresh'));
} catch (e) { console.log('error:', e.message); fail = true; }
finally { await A.close(); await B.close(); process.exitCode = fail ? 1 : 0; }
