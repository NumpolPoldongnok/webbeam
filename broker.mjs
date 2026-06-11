#!/usr/bin/env node
// WebBeam signaling broker — จิ๋ว ไม่มี dependency (ใช้ Node ล้วน)
// หน้าที่: เป็น "ตู้ฝากจดหมาย" ให้สองเครื่องแลก offer/answer กันเองอัตโนมัติ
// ไม่ส่งไฟล์ผ่านตัวนี้ — ไฟล์ยังวิ่ง P2P ตรงเหมือนเดิม · ใช้แค่ตอนจับคู่
//
// รัน:  node broker.mjs           (พอร์ตปริยาย 8787)
//       PORT=9000 node broker.mjs (เปลี่ยนพอร์ต)
import http from "node:http";
import os from "node:os";

const PORT = process.env.PORT || 8787;
let mailbox = { offer: null, answer: null, ts: 0 };

const send = (res, code, body, type) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  // Chrome Private Network Access: ให้หน้าเว็บ (file/http) fetch มา private IP ได้
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.writeHead(code, type ? { "content-type": type } : undefined);
  res.end(body || "");
};

const server = http.createServer((req, res) => {
  const u = (req.url || "").split("?")[0];
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "POST" && (u === "/offer" || u === "/answer" || u === "/reset")) {
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      if (u === "/offer") { mailbox = { offer: b, answer: null, ts: Date.now() }; }
      else if (u === "/answer") { mailbox.answer = b; }
      else { mailbox = { offer: null, answer: null, ts: 0 }; }
      send(res, 200, "ok");
    });
    return;
  }
  if (req.method === "GET" && u === "/offer")  return mailbox.offer  ? send(res, 200, mailbox.offer,  "text/plain") : send(res, 204, "");
  if (req.method === "GET" && u === "/answer") return mailbox.answer ? send(res, 200, mailbox.answer, "text/plain") : send(res, 204, "");
  if (req.method === "GET" && u === "/ping")   return send(res, 200, "ok", "text/plain");
  send(res, 404, "");
});

server.listen(PORT, () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === "IPv4" && !i.internal) ips.push(i.address);
  console.log("\n  🔥 WebBeam broker พร้อมแล้ว (พอร์ต " + PORT + ")\n");
  console.log("  • เครื่องหลัก (เครื่องนี้):  Broker IP = localhost");
  if (ips.length) {
    console.log("  • อีกเครื่อง ใส่ Broker IP =  " + ips[0] + (PORT == 8787 ? "" : ":" + PORT));
    if (ips.length > 1) console.log("    (IP อื่นบนเครื่องนี้: " + ips.slice(1).join(", ") + ")");
  }
  console.log("\n  ปล่อยหน้าต่างนี้ไว้ระหว่างใช้งาน · กด Ctrl+C เพื่อหยุด\n");
});
