# WebBeam E2E test

ทดสอบจริง: เปิด Chrome 2 instance (จำลอง 2 เครื่อง) → handshake ผ่าน WebRTC →
ส่งไฟล์ → ตรวจ SHA-256 ฝั่งรับว่าตรงกับฝั่งส่ง

## รัน

```bash
cd WebBeam/test
npm init -y && npm i puppeteer-core
node e2e.mjs            # ไฟล์ 5MB (ดีฟอลต์)
MB=120 node e2e.mjs     # ไฟล์ 120MB (ทดสอบ backpressure ของไฟล์ใหญ่)
```

ต้องมี Google Chrome ติดตั้งอยู่ (ตั้ง `CHROME=/path/to/chrome` ถ้า path ต่างจากดีฟอลต์ macOS)

## ผลที่ยืนยันแล้ว

- ✅ 5MB — เชื่อมต่อ + รับครบ SHA-256 ตรง
- ✅ 120MB — เชื่อมต่อ + รับครบ SHA-256 ตรง (ผ่าน path backpressure)

## บั๊กที่เทสต์นี้จับได้ (แก้แล้วใน index.html)

1. **`waitDrain()` race** — ถ้า buffer ระบายต่ำกว่า threshold ก่อน `addEventListener('bufferedamountlow')`
   พอดี → event ไม่ยิงอีก → ค้างถาวร แก้โดยเช็ค buffer ที่ต่ำอยู่แล้ว + polling สำรอง
2. **send queue full** — Chrome จำกัด `bufferedAmount` ≤ ~16MB แต่เดิมตั้ง `HIGH_WATER = 16MB` พอดี
   ทำให้ส่ง chunk ถัดไปทะลุ cap → `send()` throw + channel ตาย แก้โดยลด HIGH_WATER เหลือ 4MB

## หมายเหตุ

- ใช้ 2 browser แยกกัน (ไม่ใช่ 2 แท็บใน browser เดียว) เพราะ headless จะ throttle แท็บที่อยู่ background
  ทำให้ ICE/handshake ของแท็บที่ไม่ได้ aktif ค้าง — 2 process แยกคือสภาพจริง (คนละเครื่อง) อยู่แล้ว
- ขับ UI ผ่าน `page.evaluate(...click())` แทน `page.click()` เพราะ box-model CDP call ของ puppeteer
  เวอร์ชันเก่าค้างกับ Chrome เวอร์ชันใหม่กว่า
