import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('login, persistence, validation and atomic sales',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erp-test-'));let child,base,cookie='',csrf='';
 async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',ERP_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let output='';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),10000);child.once('error',reject);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127.0.0.1:(\d+)/);if(match){base=match[0];clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited: '+code));});});}
 async function stop(){if(child?.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}}
 async function call(path,method='GET',body,extra={}){const r=await fetch(base+'/api/'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),Cookie:cookie,'X-CSRF-Token':csrf,...extra},body:body===undefined?undefined:JSON.stringify(body)});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];const result=await r.json();if(result.csrfToken)csrf=result.csrfToken;return {status:r.status,data:result};}
 try{
 await start();
 assert.equal((await call('state')).status,401);
 assert.equal((await call('setup','POST',{name:'Administrator',email:'admin@school.test',password:'short'})).status,400);
 assert.equal((await call('setup','POST',{name:'Administrator',email:'admin@school.test',password:'test-password-123'})).status,201);
 assert.equal((await call('setup','POST',{name:'Administrator',email:'admin@school.test',password:'test-password-123'})).status,409);
 assert.equal((await call('products','POST',{sku:'A1',name:'Widget',price:12500,stock:5})).status,201);
 assert.equal((await call('products','POST',{sku:'A1',name:'Duplicate',price:1,stock:1})).status,409);
 assert.equal((await call('products','POST',{sku:'B',name:'Bad',price:1,stock:-1})).status,400);
 assert.equal((await call('customers','POST',{name:'Acme',email:'buyer@example.com'})).status,201);
 const order={customer_id:1,lines:[{product_id:1,quantity:2}]};
 assert.equal((await call('orders','POST',order, {Origin:'https://evil.example'})).status,403);
 assert.equal((await call('orders','POST',order)).status,201);
 let data=(await call('state')).data;assert.equal(data.products[0].stock,3);assert.equal(data.orders[0].total,25000);
 assert.equal((await call('orders','POST',{customer_id:1,lines:[{product_id:1,quantity:4}]})).status,400);
 assert.equal((await call('orders','POST',{customer_id:1,lines:[{product_id:1,quantity:1},{product_id:999,quantity:1}]})).status,400);
 data=(await call('state')).data;assert.equal(data.products[0].stock,3);assert.equal(data.orders.length,1);
 assert.equal((await fetch(base+'/server.js')).status,404);
 assert.match((await fetch(base+'/')).headers.get('content-security-policy'),/frame-ancestors 'none'/);

 // School records are validated and linked to real students.
 assert.equal((await call('customers','POST',{name:'Riya Sharma',admission_no:'SD-001',class_name:'5 A',guardian:'Anita Sharma',phone:'9876543210'})).status,201);
 assert.equal((await call('customers','POST',{name:'Duplicate',admission_no:'SD-001'})).status,409);
 const payment={student_id:2,purpose:'April tuition fee',amount:250000,payment_date:'2026-10-16',method:'UPI'};
 assert.equal((await call('fees','POST',payment)).status,201);
 assert.equal((await call('fees','POST',{...payment,amount:0})).status,400);
 assert.equal((await call('fees','POST',{...payment,student_id:999})).status,400);
 assert.equal((await call('fees','POST',{...payment,payment_date:'2026-02-30'})).status,400);
 assert.equal((await call('fees','POST',{...payment,method:'invalid'})).status,400);
 assert.equal((await call('attendance','POST',{date:'2026-10-16',records:[{student_id:2,status:'Present'}]})).status,200);
 assert.equal((await call('attendance','POST',{date:'2026-10-16',records:[{student_id:2,status:'Absent'},{student_id:999,status:'Present'}]})).status,400);
 assert.equal((await call('attendance?date=2026-10-16')).data.records[0].status,'Present');
 assert.equal((await call('attendance','POST',{date:'2026-10-16',records:[{student_id:2,status:'On leave'}]})).status,200);
 assert.equal((await call('attendance?date=2026-02-30')).status,400);
 const school=(await call('state')).data;
 assert.equal(school.feeTotal,250000);assert.equal(school.fees[0].student,'Riya Sharma');
 assert.equal(school.customers.find(c=>c.id===2).class_name,'5 A');
 assert.match(await (await fetch(base+'/')).text(),/Shambhu Dayal Global School/);

 await stop();await start();cookie='';
 assert.equal((await call('state')).status,401);
 assert.equal((await call('login','POST',{email:'admin@school.test',password:'wrong'})).status,401);
 assert.equal((await call('login','POST',{name:'Administrator',email:'admin@school.test',password:'test-password-123'})).status,200);
 data=(await call('state')).data;assert.equal(data.products[0].stock,3);assert.equal(data.orders.length,1);

 assert.equal(data.fees.length,1);assert.equal(data.feeTotal,250000);
 assert.equal((await call('attendance?date=2026-10-16')).data.records[0].status,'On leave');

 assert.equal((await call('logout','POST',{})).status,200);assert.equal((await call('state')).status,401);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});

