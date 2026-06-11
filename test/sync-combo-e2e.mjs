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

const A = await launch('cbA'), B = await launch('cbB');
let fail = false;
const chk = (c, m) => { if (c) log('  ✓ ' + m); else { log('  ❌ ' + m); fail = true; } };
try {
  const pa = await A.newPage(), pb = await B.newPage();
  for (const [p, w] of [[pa,'A'],[pb,'B']]) p.on('pageerror', e => { console.log(w+' pageerror:', e.message); fail = true; });
  await pa.goto(URL); await pb.goto(URL);

  // offline handshake
  await click(pa, '#btnCreateOffer');
  await pa.waitForFunction(() => document.getElementById('offerOut').value.length > 0, { timeout: 10000 });
  const offer = await getVal(pa, '#offerOut');
  await click(pb, '#roleSeg button[data-role="b"]');
  await setVal(pb, '#offerIn', offer); await click(pb, '#btnCreateAnswer');
  await pb.waitForFunction(() => document.getElementById('answerOut').value.length > 0, { timeout: 10000 });
  await setVal(pa, '#answerIn', await getVal(pb, '#answerOut')); await click(pa, '#btnAcceptAnswer');
  await Promise.all([pa.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000}), pb.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000})]);
  log('✓ เชื่อมต่อแล้ว (connection เดียว)');

  await pa.evaluate(()=>SYNC.initMem({ 'a.txt':'A1', 'sub/b.js':'console.log(2)' }));
  await pb.evaluate(()=>SYNC.initMem({}));

  // 1) แชตข้อความ A → B
  await pa.evaluate(()=>SYNC.sendChat('hello-สวัสดี-MARK1'));
  await pb.waitForFunction(()=>SYNC.chatText().includes('MARK1'), {timeout:8000});
  chk(true, 'B ได้ข้อความแชตจาก A');

  // 2) พร้อมกัน: B สั่ง pull sync + A ส่งแชต/ไฟล์โค้ดมาแทรก
  log('— ยิงพร้อมกัน: B pull sync + A ส่งแชต + A ส่งไฟล์โค้ด');
  await Promise.all([
    pb.evaluate(()=>SYNC.pullAll()),
    pa.evaluate(()=>SYNC.sendChat('ระหว่าง sync-MARK2')),
    pa.evaluate(()=>SYNC.sendChatFile('snippet.js', 'export const x = 42; // CODEMARK')),
  ]);

  // sync ไฟล์ถึงครบ
  await pb.waitForFunction(()=>{ const d=SYNC.dump(); return d && d['a.txt']==='A1' && d['sub/b.js']==='console.log(2)'; }, {timeout:15000});
  chk(true, 'B ได้ไฟล์ sync ครบ (a.txt + sub/b.js) ถูกต้อง ระหว่างมีแชตแทรก');

  // แชตข้อความ + ไฟล์โค้ดถึง B ครบ ไม่เพี้ยน
  await pb.waitForFunction(()=>{ const t=SYNC.chatText(); return t.includes('MARK2') && t.includes('snippet.js') && t.includes('CODEMARK'); }, {timeout:10000});
  chk(true, 'B ได้ข้อความ MARK2 + ไฟล์โค้ด snippet.js (เนื้อหา CODEMARK) ครบ ไม่ปนกับ sync');

  // 3) ไฟล์ sync ไม่หลุดไปอยู่ในแชต / ไฟล์แชตไม่หลุดไปเขียนโฟลเดอร์
  const bDump = await pb.evaluate(()=>SYNC.dump());
  chk(!('snippet.js' in bDump), 'ไฟล์แชต (snippet.js) ไม่ถูกเขียนลงโฟลเดอร์ sync');
  const aChat = await pa.evaluate(()=>SYNC.chatText());
  chk(!aChat.includes('a.txt') && !aChat.includes('sub/b.js'), 'ไฟล์ sync ไม่โผล่ในแชตของ A');

  log('\n' + (fail ? '❌ มีข้อผิดพลาด' : '✅ PASS: แชต + ซิงค์ ทำงานพร้อมกันบน connection เดียว ไม่ปนกัน ไม่เพี้ยน'));
} catch (e) { console.log('error:', e.message); fail = true; }
finally { await A.close(); await B.close(); process.exitCode = fail ? 1 : 0; }
