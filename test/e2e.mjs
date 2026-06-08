// E2E test: เชื่อม 2 เบราว์เซอร์ผ่าน WebRTC แล้วส่งไฟล์ ตรวจ SHA-256 ว่าตรงกัน
// รัน:  npm i puppeteer-core && MB=120 node test/e2e.mjs
// ต้องมี Google Chrome ติดตั้งอยู่ (แก้ CHROME ด้านล่างถ้า path ต่าง)
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'file://' + join(HERE, '..', 'index.html');
const PROFILE_DIR = process.env.TMPDIR || '/tmp';

const log = (...a) => console.log(...a);
const fail = (m) => { console.error('❌ FAIL:', m); throw new Error(m); };

// launch 2 browser แยก = แต่ละหน้าเป็น foreground tab ของตัวเอง (เหมือน 2 เครื่องจริง
// เลี่ยง background-tab throttling ของ headless เมื่อใช้ browser เดียว 2 แท็บ)
const launch = (name) => puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 60000,
  userDataDir: join(PROFILE_DIR, 'webbeam-' + name),
  args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
});
const browserA = await launch('pA');
const browserB = await launch('pB');

// ขับทุกอย่างผ่าน evaluate (เลี่ยง puppeteer click()/$eval ที่ค้างกับ Chrome เวอร์ชันใหม่กว่า)
const click = (p, sel) => p.evaluate(s => document.querySelector(s).click(), sel);
const setVal = (p, sel, v) => p.evaluate((s, val) => { document.querySelector(s).value = val; }, sel, v);
const getVal = (p, sel) => p.evaluate(s => document.querySelector(s).value, sel);

try {
  const A = await browserA.newPage();
  const B = await browserB.newPage();
  for (const [p, who] of [[A, 'A'], [B, 'B']]) {
    p.on('pageerror', e => console.error(who + ' pageerror:', e.message));
    p.on('dialog', async d => { console.log(who + ' DIALOG:', d.message()); await d.accept(); });
  }

  await A.goto(URL);
  await B.goto(URL);
  log('✓ โหลดทั้งสองหน้า');

  // ---- Handshake (copy-paste signaling) ----
  await click(A, '#btnCreateOffer');
  await A.waitForFunction(() => document.getElementById('offerOut').value.length > 0, { timeout: 10000 });
  const offer = await getVal(A, '#offerOut');
  log('✓ A สร้าง offer (' + offer.length + ' ตัวอักษร)');

  await click(B, '#roleSeg button[data-role="b"]');
  await setVal(B, '#offerIn', offer);
  await click(B, '#btnCreateAnswer');
  await B.waitForFunction(() => document.getElementById('answerOut').value.length > 0, { timeout: 10000 });
  const answer = await getVal(B, '#answerOut');
  log('✓ B สร้าง answer (' + answer.length + ' ตัวอักษร)');

  await setVal(A, '#answerIn', answer);
  await click(A, '#btnAcceptAnswer');

  const waitOpen = (p, who) => p.waitForFunction(
    () => typeof channel !== 'undefined' && channel && channel.readyState === 'open',
    { timeout: 20000 }
  ).then(() => log('✓ ' + who + ' data channel OPEN'));
  await Promise.all([waitOpen(A, 'A'), waitOpen(B, 'B')]);

  // ---- capture ฝั่ง B (override finishIncoming เก็บ hash แทนดาวน์โหลด) ----
  await B.evaluate(() => {
    window.__recv = null;
    finishIncoming = async function () {
      const buf = await new Blob(incoming.parts).arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      window.__recv = {
        size: buf.byteLength,
        hash: [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''),
      };
      incoming = null;
    };
  });

  // ---- A ส่งไฟล์ (deterministic) ----
  const SIZE = Number(process.env.MB || 5) * 1024 * 1024;
  const sentHash = await A.evaluate(async (size) => {
    const arr = new Uint8Array(size);
    for (let i = 0; i < size; i++) arr[i] = (i * 2654435761 >>> 16) & 0xff;
    const h = await crypto.subtle.digest('SHA-256', arr);
    queueFiles([new File([arr], 'test.bin', { type: 'application/octet-stream' })]);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }, SIZE);
  log('✓ A เริ่มส่งไฟล์ ' + (SIZE / 1048576) + 'MB · hash=' + sentHash.slice(0, 16) + '…');

  // ---- รอ B รับครบ ----
  await B.waitForFunction(() => window.__recv !== null, { timeout: 60000 });
  const recv = await B.evaluate(() => window.__recv);
  log('— ผลการรับ: size=' + recv.size + ' hash=' + recv.hash.slice(0, 16) + '…');

  if (recv.size !== SIZE) fail(`ขนาดไม่ตรง: ส่ง ${SIZE} รับ ${recv.size}`);
  if (recv.hash !== sentHash) fail('hash ไม่ตรง — ไฟล์เพี้ยน');

  log('\n✅ PASS: WebRTC P2P + ส่งไฟล์ ' + (SIZE / 1048576) + 'MB ครบถ้วนถูกต้อง (SHA-256 ตรงกัน)');
} catch (e) {
  console.error('error:', e.message);
  process.exitCode = 1;
} finally {
  await browserA.close();
  await browserB.close();
}
