// สาธิตว่าแถบ progress ขึ้นจริงตอน sync ไฟล์เยอะ + ไฟล์ใหญ่
// จับการเปลี่ยนของ #progress ด้วย MutationObserver ทั้งสองฝั่ง แล้วพิมพ์ลำดับที่เห็น
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file:///Users/numpolpoldongnok/Documents/GitHub/LocalWork/WebBeam/sync.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const launch = (p) => puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 60000,
  userDataDir: '/tmp/webbeam-test/' + p, args: ['--no-sandbox','--no-first-run','--no-default-browser-check'] });
const click = (pg, s) => pg.evaluate(x => document.querySelector(x).click(), s);
const setVal = (pg, s, v) => pg.evaluate((x, val) => { document.querySelector(x).value = val; }, s, v);
const getVal = (pg, s) => pg.evaluate(x => document.querySelector(x).value, s);

// ติดตั้งตัวจับ progress ลงในหน้า — เก็บทุกครั้งที่ #progText/#progPct เปลี่ยน (และตอนซ่อน)
const installSpy = (pg) => pg.evaluate(() => {
  window.__prog = [];
  const p = document.getElementById('progress');
  const rec = () => {
    const hidden = p.classList.contains('hidden');
    const txt = document.getElementById('progText').textContent;
    const pct = document.getElementById('progPct').textContent;
    const last = window.__prog[window.__prog.length - 1];
    const cur = hidden ? '· (ซ่อนแถบ)' : (txt + (pct ? '  ' + pct : '  [แถบวิ่ง]'));
    if (cur !== last) window.__prog.push(cur);
  };
  new MutationObserver(rec).observe(p, { attributes: true, childList: true, subtree: true, characterData: true });
});
const dumpSpy = (pg) => pg.evaluate(() => window.__prog || []);

const A = await launch('sA'), B = await launch('sB');
try {
  const pa = await A.newPage(), pb = await B.newPage();
  for (const [p, w] of [[pa,'A'],[pb,'B']]) p.on('pageerror', e => console.log(w+' pageerror:', e.message));
  await pa.goto(URL); await pb.goto(URL);
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
  console.log('✓ เชื่อมต่อแล้ว\n');

  await pa.evaluate(()=>{ document.getElementById('autoSync').checked=false; document.getElementById('autoSync').dispatchEvent(new Event('change')); });
  await pb.evaluate(()=>{ document.getElementById('autoSync').checked=false; document.getElementById('autoSync').dispatchEvent(new Event('change')); });

  await installSpy(pa); await installSpy(pb);

  // A: ไฟล์เล็ก 8 ไฟล์ (กระตุ้น progress ตอนคำนวณ hash) + ไฟล์ใหญ่ ~2MB (กระตุ้น progress ตอนส่ง/รับ)
  await pa.evaluate(() => {
    const files = {};
    for (let i = 0; i < 8; i++) files['doc' + i + '.txt'] = 'เนื้อหาไฟล์ที่ ' + i + ' '.repeat(50);
    files['big.bin'] = 'X'.repeat(2 * 1024 * 1024); // ~2MB → หลายร้อย chunk
    SYNC.initMem(files, 'memBig');
  });
  await pb.evaluate(() => SYNC.initMem({}, 'memBigB')); // B ว่าง รอรับ

  console.log('เริ่ม sync (A มี 9 ไฟล์ รวมไฟล์ใหญ่ ~2MB → B ว่างเปล่า)…\n');
  for (let i = 0; i < 8; i++) { await Promise.all([pa.evaluate(()=>SYNC.syncNow()), pb.evaluate(()=>SYNC.syncNow())]); await wait(400); }

  const progA = await dumpSpy(pa), progB = await dumpSpy(pb);
  console.log('── แถบ progress ที่ฝั่ง A (ผู้ส่ง) แสดง ──');
  progA.forEach(l => console.log('   ' + l));
  console.log('\n── แถบ progress ที่ฝั่ง B (ผู้รับ) แสดง ──');
  progB.forEach(l => console.log('   ' + l));

  const got = await pb.evaluate(()=>Object.keys(SYNC.dump()).length);
  const big = await pb.evaluate(()=>{ const d=SYNC.dump(); return d['big.bin'] ? d['big.bin'].length : 0; });
  console.log('\nผล: B ได้รับ ' + got + ' ไฟล์, big.bin ขนาด ' + big + ' bytes');
  console.log(progA.length && progB.length ? '✅ แถบ progress ทำงานทั้งฝั่งส่งและฝั่งรับ' : '❌ ไม่เห็นการอัปเดต progress');
} catch (e) { console.log('error:', e.message, e.stack); }
finally { await A.close(); await B.close(); }
