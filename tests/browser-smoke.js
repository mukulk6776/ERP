import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {browserBinary} from './browser-binary.js';
const dir=mkdtempSync(join(tmpdir(),'school-browser-'));
let server,browser,ws;const pending=new Map();let nextId=0;const errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const response=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;}
try{
 server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',ERP_DATA_DIR:join(dir,'data')},windowsHide:true});
 const base=await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',s=>{out+=s;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0]);});server.on('error',reject);});
 browser=spawn(browserBinary(),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+join(dir,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
 let browserError;browser.on('error',error=>browserError=error);
 const portFile=join(dir,'profile','DevToolsActivePort');for(let i=0;i<100&&!existsSync(portFile);i++){if(browserError)throw browserError;await sleep(200);}
 let target;
 for(let i=0;i<100&&!target;i++){
  try{const port=readFileSync(portFile,'utf8').split('\n')[0];const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=targets.find(t=>t.type==='page');}catch{}
  if(!target)await sleep(200);
 }
 assert.ok(target,'Chrome debugging endpoint did not become ready');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);};
 await rpc('Runtime.enable');await rpc('Page.enable');await rpc('Emulation.setDeviceMetricsOverride',{width:1365,height:950,deviceScaleFactor:1,mobile:false});
 await rpc('Page.navigate',{url:base});
 await sleep(500);
 await evaluate("(async()=>{for(let i=0;i<100&&!document.querySelector('#login');i++)await new Promise(r=>setTimeout(r,50));if(!document.querySelector('#login'))throw Error('Sign-in did not load');})()");
 const layout=await rpc('Page.getLayoutMetrics');
 const authPreview=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:layout.cssContentSize.width,height:layout.cssContentSize.height,scale:1}});
 writeFileSync('tests/auth-desktop.png',Buffer.from(authPreview.data,'base64'));

 const result=await evaluate("(async()=>{\n const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI did not finish: '+predicate);};\n const click=s=>{const el=document.querySelector(s);if(!el)throw Error('Missing '+s);el.click();};\n const set=(name,value)=>{document.querySelector('[name=\"'+name+'\"]').value=value;};\n const submit=()=>(document.querySelector('dialog[open] form')||document.querySelector('#app form')).requestSubmit();\n await wait(()=>document.querySelector('#login'));\n set('name','Browser Admin');set('email','browser-admin@school.test');set('password','browser-test-password');set('confirmPassword','browser-test-password');\n const passToggle=document.querySelector('[name=\"password\"]').parentElement.querySelector('button');\n passToggle.click();if(document.querySelector('[name=\"password\"]').type!=='text')throw Error('Show password failed');passToggle.click();\n const confirmInput=document.querySelector('[name=\"confirmPassword\"]');\n confirmInput.value='different confirmation';confirmInput.dispatchEvent(new Event('input'));\n if(document.querySelector('#login').checkValidity())throw Error('Mismatched passwords should not submit');\n confirmInput.value='browser-test-password';confirmInput.dispatchEvent(new Event('input'));\ndocument.querySelector('#login').requestSubmit();\n await wait(()=>document.querySelector('[data-view=\"customers\"]'));\n click('[data-view=\"customers\"]');click('[data-add=\"customers\"]');\n set('name','Aarav Gupta');set('admission_no','SDGS-101');set('class_name','5 A');set('guardian','Neha Gupta');set('phone','9876543210');submit();\n await wait(()=>state.customers.length===1&&!document.querySelector('dialog').open);\n if(!document.body.textContent.includes('Aarav Gupta'))throw Error('Student not displayed');\n click('[data-view=\"attendance\"]');await wait(()=>document.querySelector('[data-attendance]'));\n const select=document.querySelector('[data-attendance]');select.value='Present';select.dispatchEvent(new Event('change'));\n click('[data-add=\"attendance\"]');await wait(()=>!attendanceDirty);\n const attendance=await api('attendance?date='+attendanceDate);if(attendance.records[0].status!=='Present')throw Error('Attendance not saved');\n click('[data-view=\"fees\"]');click('[data-add=\"fees\"]');set('purpose','October tuition');set('amount','2500');submit();\n await wait(()=>state.fees.length===1&&!document.querySelector('dialog').open);\n click('[data-receipt]');if(!document.querySelector('.receipt').textContent.includes('Aarav Gupta'))throw Error('Receipt missing student');click('#close-receipt');\n click('[data-view=\"inventory\"]');click('[data-add=\"inventory\"]');set('name','Class 5 Maths book');set('sku','BOOK-5M');set('price','150');set('stock','8');submit();\n await wait(()=>state.products.length===1&&!document.querySelector('dialog').open);\n click('[data-view=\"orders\"]');click('[data-add=\"orders\"]');submit();\n await wait(()=>state.orders.length===1&&!document.querySelector('dialog').open);\n if(state.products[0].stock!==7)throw Error('Supply count not reduced');\n click('[data-view=\"dashboard\"]');\n if(!document.body.textContent.includes('2,500.00'))throw Error('Fee total not displayed');\n \n const schoolResult={student:state.customers[0].name,attendance:attendance.records[0].status,fees:state.feeTotal,remainingSupplies:state.products[0].stock,title:document.title};\n click('[data-view=\"users\"]');await wait(()=>document.querySelector('#user-list table'));\n \n const staffSearch=document.querySelector('#staff-search');staffSearch.value='no matching staff';staffSearch.dispatchEvent(new Event('input'));\n if(!document.querySelector('#user-list').textContent.includes('No staff match'))throw Error('Staff search did not filter');\n staffSearch.value='';staffSearch.dispatchEvent(new Event('input'));\n const staffFilter=document.querySelector('#staff-status');staffFilter.value='pending';staffFilter.dispatchEvent(new Event('change'));\n if(!document.querySelector('#user-list').textContent.includes('No staff match'))throw Error('Active administrator incorrectly shown as pending');\n staffFilter.value='';staffFilter.dispatchEvent(new Event('change'));\nclick('[data-add=\"users\"]');set('name','Teacher Browser');set('email','teacher-browser@school.test');set('role','teacher');submit();\n await wait(()=>document.querySelector('#reset-link'));\n const resetLink=document.querySelector('#reset-link').value;click('#close-link');\n location.hash=new URL(resetLink).hash;\n await wait(()=>document.querySelector(\"#back-login\")&&!document.querySelector(\"#app form\").hidden);\n set('password','teacher browser password 123');set('confirmPassword','teacher browser password 123');submit();\n await wait(()=>document.querySelector('#login'));\n set('email','teacher-browser@school.test');set('password','teacher browser password 123');document.querySelector('#login').requestSubmit();\n await wait(()=>document.querySelector('.shell')&&authSession?.user?.role==='teacher');\n if(document.querySelector('[data-view=\"fees\"]')||document.querySelector('[data-view=\"users\"]'))throw Error('Teacher can see restricted navigation');\n if(document.querySelector('[data-add=\"customers\"]'))throw Error('Teacher can add students');\n click('#account-button');set('currentPassword','teacher browser password 123');set('password','changed teacher password 123');set('confirmPassword','changed teacher password 123');submit();\n await wait(()=>!document.querySelector('dialog').open);\n click('#logout');await wait(()=>document.querySelector('#login'));\n set('email','teacher-browser@school.test');set('password','changed teacher password 123');document.querySelector('#login').requestSubmit();\n await wait(()=>document.querySelector('.shell')&&authSession?.user?.role==='teacher');\n return {...schoolResult,staffRole:authSession.user.role};\n\n})()");
 console.log(JSON.stringify(result));
 await rpc('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'Mobile layout overflows');
 const screenshot=await rpc('Page.captureScreenshot',{format:'png'});writeFileSync('tests/school-preview.png',Buffer.from(screenshot.data,'base64'));

 await evaluate("api('logout','POST',{}).then(()=>init())");
 await evaluate("(async()=>{for(let i=0;i<100&&!document.querySelector('#login');i++)await new Promise(r=>setTimeout(r,50));const help=document.querySelector('#signin-help');if(!help)throw Error('Missing sign-in help');help.click();if(help.getAttribute('aria-expanded')!=='true')throw Error('Sign-in help did not open');})()");
 assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'Mobile sign-in layout overflows');
 const mobileAuth=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
 writeFileSync('tests/auth-mobile.png',Buffer.from(mobileAuth.data,'base64'));

 await evaluate(`(async()=>{
  const wait=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('Auth regression timed out: '+predicate);};
  const signIn=async(email,password)=>{
   document.querySelector('[name="email"]').value=email;document.querySelector('[name="password"]').value=password;
   document.querySelector('#login').requestSubmit();await wait(()=>document.querySelector('.shell'));
  };
  await signIn('browser-admin@school.test','browser-test-password');
  await init();if(authSession.user.role!=='admin')throw Error('Session did not survive refresh');
  const realFetch=window.fetch;
  let release,recordsPending=false;
  const gate=new Promise(resolve=>{release=resolve;});
  window.fetch=async(url,options)=>{const response=await realFetch(url,options);if(url==='/api/state'){recordsPending=true;await gate;}return response;};
  const loading=init();await wait(()=>recordsPending);login(false);release();await loading;window.fetch=realFetch;
  if(!document.querySelector('#login')||state.customers.length)throw Error('Delayed records restored a signed-out account');
  await signIn('browser-admin@school.test','browser-test-password');
  // Expire the session after init reads it, before it loads school records.
  window.fetch=async(url,options)=>{
   if(url==='/api/state'){
    window.fetch=realFetch;
    await realFetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':authSession.csrfToken},body:'{}'});
   }
   return realFetch(url,options);
  };
  await init();
  if(!document.querySelector('#login')||document.body.textContent.includes('Unable to connect'))throw Error('Expired session did not show sign-in');
  if(state.customers.length||authSession||document.querySelector('dialog[open]'))throw Error('Expired session retained account data');
  await signIn('browser-admin@school.test','browser-test-password');
  document.querySelector('#account-button').click();
  await realFetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':authSession.csrfToken},body:'{}'});
  document.querySelector('[name="currentPassword"]').value='browser-test-password';
  document.querySelector('[name="password"]').value='replacement admin password';
  document.querySelector('[name="confirmPassword"]').value='replacement admin password';
  document.querySelector('dialog form').requestSubmit();
  await wait(()=>document.querySelector('#login'));
  if(document.querySelector('dialog[open]'))throw Error('Expired session left an account dialog open');
  await signIn('browser-admin@school.test','browser-test-password');
  const invite=await api('users','POST',{name:'Link Test',email:'link-test@school.test',role:'accountant'});
  location.hash='reset='+invite.resetToken;
  await wait(()=>document.querySelector('#back-login')&&!document.querySelector('#app form').hidden);
  if(!document.body.textContent.includes('link-test@school.test'))throw Error('Password link did not identify the intended account');
  if(location.hash)throw Error('Password token remained in the address bar');
  document.querySelector('[name="password"]').value='link test password 123';
  document.querySelector('[name="confirmPassword"]').value='link test password 123';
  document.querySelector('#app form').requestSubmit();await wait(()=>document.querySelector('#login'));
  if(document.querySelector('[name="email"]').value!=='link-test@school.test')throw Error('Reset did not prefill staff email');
  if((await api('session')).authenticated)throw Error('Reset retained the previous browser session');
  await signIn('link-test@school.test','link test password 123');
  if(authSession.user.role!=='accountant'||document.querySelector('[data-view="attendance"]'))throw Error('Accounts role permissions are incorrect');
  location.hash='reset='+invite.resetToken;
  await wait(()=>document.body.textContent.includes('This link is invalid or has expired'));
  if(document.querySelector('[name="password"]'))throw Error('Used password link still showed a password form');
  document.querySelector('#back-login').click();await wait(()=>document.querySelector('.shell'));
  document.querySelector('#account-button').click();document.querySelector('#logout-all').click();
  await wait(()=>document.querySelector('#login'));
  if((await api('session')).authenticated||state.customers.length)throw Error('Sign out on all devices failed');
 })()`);
 console.log('Session expiry, password links, recovery, and accounts role passed.');

 assert.equal(errors.length,0,JSON.stringify(errors));console.log('Browser workflows and mobile layout passed.');
 await rpc('Browser.close').catch(()=>{});
}finally{ws?.close();browser?.kill();server?.kill();await sleep(500);try{rmSync(dir,{recursive:true,force:true});}catch{}}
