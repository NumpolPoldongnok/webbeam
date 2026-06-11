import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL='file:///Users/numpolpoldongnok/Documents/GitHub/LocalWork/WebBeam/sync.html';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const launch=(p)=>puppeteer.launch({executablePath:CHROME,headless:true,protocolTimeout:60000,userDataDir:'/tmp/webbeam-test/'+p,args:['--no-sandbox','--no-first-run','--no-default-browser-check']});
const click=(pg,s)=>pg.evaluate(x=>document.querySelector(x).click(),s);
const setV=(pg,s,v)=>pg.evaluate((x,val)=>{document.querySelector(x).value=val;},s,v);
const getV=(pg,s)=>pg.evaluate(x=>document.querySelector(x).value,s);
const A=await launch('inA'),B=await launch('inB'); let fail=false;
const chk=(c,m)=>{if(c)console.log('  ✓ '+m);else{console.log('  ❌ '+m);fail=true;}};
try{
  const pa=await A.newPage(),pb=await B.newPage();
  pa.on('pageerror',e=>{console.log('A',e.message);fail=true;}); pb.on('pageerror',e=>{console.log('B',e.message);fail=true;});
  await pa.goto(URL); await pb.goto(URL);
  await click(pa,'#btnCreateOffer'); await pa.waitForFunction(()=>document.getElementById('offerOut').value.length>0,{timeout:10000});
  await click(pb,'#roleSeg button[data-role="b"]'); await setV(pb,'#offerIn',await getV(pa,'#offerOut'));
  await click(pb,'#btnCreateAnswer'); await pb.waitForFunction(()=>document.getElementById('answerOut').value.length>0,{timeout:10000});
  await setV(pa,'#answerIn',await getV(pb,'#answerOut')); await click(pa,'#btnAcceptAnswer');
  await Promise.all([pa.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000}),pb.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000})]);
  console.log('✓ connected');
  await pa.evaluate(()=>SYNC.initMem({'a.txt':'A1','b.txt':'B1','c/d.txt':'D1'}));
  await pb.evaluate(()=>SYNC.initMem({}));
  const downB=async()=>(await pb.evaluate(()=>SYNC.stats())).down;

  // รอบ 1
  await pb.evaluate(()=>SYNC.pullAll()); await wait(2000);
  const d1=await downB(); chk(d1===3,'รอบ1: รับครบ 3 ไฟล์ (down='+d1+')');
  chk(JSON.stringify(await pb.evaluate(()=>SYNC.dump()))===JSON.stringify({'a.txt':'A1','b.txt':'B1','c/d.txt':'D1'}),'รอบ1: เนื้อหาครบถูกต้อง');

  // รอบ 2 (ไม่มีอะไรเปลี่ยน)
  await pb.evaluate(()=>SYNC.pullAll()); await wait(2000);
  const d2=await downB(); chk(d2===d1,'รอบ2: ไม่รับเพิ่มเลย (ข้ามทั้งหมด) down='+d2);

  // แก้ a.txt ฝั่ง A → รอบ 3 ส่งแค่ 1
  await pa.evaluate(()=>SYNC.put('a.txt','A2-CHANGED'));
  await pb.evaluate(()=>SYNC.pullAll()); await wait(2000);
  const d3=await downB(); chk(d3===d2+1,'รอบ3: รับแค่ 1 ไฟล์ที่เปลี่ยน (down='+d3+')');
  chk((await pb.evaluate(()=>SYNC.dump()))['a.txt']==='A2-CHANGED','รอบ3: a.txt อัปเดตเป็นเวอร์ชันใหม่');

  console.log('\n'+(fail?'❌ มีข้อผิดพลาด':'✅ PASS: incremental — รอบแรกครบ, รอบไม่เปลี่ยนส่ง 0, แก้ 1 ไฟล์ส่งแค่ 1'));
}catch(e){console.log('error:',e.message);fail=true;}
finally{await A.close();await B.close();process.exitCode=fail?1:0;}
