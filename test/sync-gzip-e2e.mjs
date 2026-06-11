import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL='file:///Users/numpolpoldongnok/Documents/GitHub/LocalWork/WebBeam/sync.html';
const launch=(p)=>puppeteer.launch({executablePath:CHROME,headless:true,protocolTimeout:60000,userDataDir:'/tmp/webbeam-test/'+p,args:['--no-sandbox','--no-first-run','--no-default-browser-check']});
const click=(pg,s)=>pg.evaluate(x=>document.querySelector(x).click(),s);
const setV=(pg,s,v)=>pg.evaluate((x,val)=>{document.querySelector(x).value=val;},s,v);
const getV=(pg,s)=>pg.evaluate(x=>document.querySelector(x).value,s);
const A=await launch('gzA'),B=await launch('gzB'); let fail=false;
try{
  const pa=await A.newPage(),pb=await B.newPage();
  pa.on('pageerror',e=>{console.log('A',e.message);fail=true;}); pb.on('pageerror',e=>{console.log('B',e.message);fail=true;});
  await pa.goto(URL); await pb.goto(URL);
  await click(pa,'#btnCreateOffer');
  await pa.waitForFunction(()=>document.getElementById('offerOut').value.length>0,{timeout:10000});
  await click(pb,'#roleSeg button[data-role="b"]'); await setV(pb,'#offerIn',await getV(pa,'#offerOut'));
  await click(pb,'#btnCreateAnswer'); await pb.waitForFunction(()=>document.getElementById('answerOut').value.length>0,{timeout:10000});
  await setV(pa,'#answerIn',await getV(pb,'#answerOut')); await click(pa,'#btnAcceptAnswer');
  await Promise.all([pa.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000}),pb.waitForFunction(()=>SYNC.channelOpen(),{timeout:20000})]);
  // ไฟล์โค้ดใหญ่ ~12KB (ต้องถูก gzip)
  const big = await pa.evaluate(()=>{ let s='// header\n'; for(let i=0;i<400;i++) s+='function f'+i+'(){ return '+i+' * 2; } // line '+i+'\n'; SYNC.initMem({'big.js':s}); return s; });
  await pb.evaluate(()=>SYNC.initMem({}));
  await pb.evaluate(()=>SYNC.pullAll());
  await pb.waitForFunction(()=>{const d=SYNC.dump(); return d && d['big.js'];},{timeout:15000});
  const got = (await pb.evaluate(()=>SYNC.dump()))['big.js'];
  if(got===big) console.log('✅ gzip round-trip ถูกต้อง: big.js '+big.length+' ตัวอักษร ตรงเป๊ะหลังบีบอัด+แตก');
  else { console.log('❌ เนื้อหาไม่ตรง! len got='+(got?got.length:0)+' expected='+big.length); fail=true; }
}catch(e){console.log('error:',e.message);fail=true;}
finally{await A.close();await B.close();process.exitCode=fail?1:0;}
