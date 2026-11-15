import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
async function fixture(t,seed){
 const dir=mkdtempSync(join(tmpdir(),'school-auth-'));let processHandle,base;const path=join(dir,'erp.sqlite');
 if(seed){const database=new DatabaseSync(path);seed(database);database.close();}
 async function start(){
  processHandle=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',ERP_DATA_DIR:dir},windowsHide:true});
  base=await new Promise((resolve,reject)=>{let out='',err='';const timer=setTimeout(()=>reject(Error('Server timeout '+err)),10000);processHandle.stderr.on('data',s=>err+=s);processHandle.stdout.on('data',s=>{out+=s;const m=out.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});processHandle.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+err));});processHandle.on('error',reject);});
 }
 async function stop(){if(processHandle?.exitCode===null)await new Promise(resolve=>{processHandle.once('exit',resolve);processHandle.kill();});}
 t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 await start();
 function client(){
  let cookie='',csrf='';
  return {get cookie(){return cookie;},async request(route,method='GET',data,headers={}){
   const response=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...headers},body:data===undefined?undefined:JSON.stringify(data)});
   const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
   const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;
   return {status:response.status,data:result,headers:response.headers};
  }};
 }
 return {client,path,start,stop,get base(){return base;}};
}
const admin={name:'School Admin',email:'admin@school.test',password:'a long admin password 123'};
test('password links validate before use, expire, and recover locked accounts',async t=>{
 const f=await fixture(t),a=f.client(),staff=f.client();
 await a.request('setup','POST',admin);
 const invite=await a.request('users','POST',{name:'Staff Member',email:'staff@school.test',role:'teacher'});
 const token=invite.data.resetToken,id=invite.data.id;
 const invalid=await staff.request('validate-reset','POST',{token:'invalid'});
 assert.equal(invalid.status,400);assert.equal(invalid.data.email,undefined);
 const preview=await staff.request('validate-reset','POST',{token});
 assert.equal(preview.status,200);assert.equal(preview.data.email,'staff@school.test');
 assert.ok(preview.data.expiresAt>Date.now());
 assert.equal((await staff.request('validate-reset','POST',{token})).status,200,'Preview does not consume the link');
 const replaced=await a.request('users/'+id+'/reset','POST',{});
 assert.equal((await staff.request('validate-reset','POST',{token})).status,400);
 const newToken=replaced.data.resetToken;
 const db=new DatabaseSync(f.path);try{
 assert.ok(db.prepare('SELECT token_hash FROM password_resets').all().every(row=>row.token_hash!==newToken));
 db.prepare('UPDATE password_resets SET expires_at=0 WHERE user_id=?').run(id);
 assert.equal((await staff.request('validate-reset','POST',{token:newToken})).status,400);
 const fresh=await a.request('users/'+id+'/reset','POST',{});
 const secret='private staff password 123';
 assert.equal((await staff.request('reset-password','POST',{token:fresh.data.resetToken,password:secret})).status,200);
 assert.equal((await staff.request('validate-reset','POST',{token:fresh.data.resetToken})).status,400);
 assert.equal((await staff.request('login','POST',{email:'staff@school.test',password:secret})).status,200);
 const other=f.client();await other.request('login','POST',{email:'staff@school.test',password:secret});
 const recovery=await a.request('users/'+id+'/reset','POST',{});
 for(let i=0;i<10;i++)assert.equal((await f.client().request('login','POST',{email:'staff@school.test',password:'incorrect password'})).status,401);
 assert.equal((await f.client().request('login','POST',{email:'staff@school.test',password:secret})).status,429);
 const reset=await staff.request('reset-password','POST',{token:recovery.data.resetToken,password:'recovered staff password 123'});
 assert.equal(reset.status,200);assert.match(reset.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await other.request('state')).status,401);
 assert.equal((await staff.request('login','POST',{email:'staff@school.test',password:'recovered staff password 123'})).status,200);
 const disabled=await a.request('users/'+id+'/reset','POST',{});
 await a.request('users/'+id,'PATCH',{role:'teacher',active:false});
 assert.equal((await staff.request('validate-reset','POST',{token:disabled.data.resetToken})).status,400);
 }finally{db.close();}
});

test('successful sign-ins do not accumulate account lockout and absolute expiry is enforced',async t=>{
 const f=await fixture(t),a=f.client(),b=f.client();
 await a.request('setup','POST',admin);
 const db=new DatabaseSync(f.path);try{
 for(let i=0;i<12;i++)assert.equal((await b.request('login','POST',{email:admin.email,password:admin.password})).status,200);
 const original=a.cookie;
 assert.equal((await a.request('change-password','POST',{currentPassword:admin.password,password:'changed administrator password 123'})).status,200);
 assert.notEqual(a.cookie,original);assert.equal((await b.request('state')).status,401);
 const replay=await fetch(f.base+'/api/state',{headers:{Cookie:original}});assert.equal(replay.status,401);
 db.prepare('UPDATE auth_sessions SET expires_at=0').run();
 assert.equal((await a.request('state')).status,401);
 }finally{db.close();}
});

test('individual accounts, RBAC, CSRF, revocation and reset links',async t=>{
 const f=await fixture(t),a=f.client(),teacher=f.client(),other=f.client();
 assert.equal((await a.request('session')).data.setupRequired,true);
 assert.equal((await a.request('setup','POST',{...admin,password:'short'})).status,400);
 const created=await a.request('setup','POST',admin);assert.equal(created.status,201);assert.equal(created.data.user.role,'admin');
 assert.match(created.headers.get('set-cookie'),/HttpOnly/);assert.match(created.headers.get('set-cookie'),/SameSite=Strict/);
 assert.equal((await a.request('setup','POST',admin)).status,409);
 assert.equal((await other.request('login','POST',{email:admin.email,password:'bad'})).status,401);
 assert.equal((await a.request('users','POST',{name:'Teacher',email:'teacher@school.test',role:'superuser'})).status,400);
 const invite=await a.request('users','POST',{name:'Teacher',email:'teacher@school.test',role:'teacher'});assert.equal(invite.status,201);
 assert.equal((await a.request('users','POST',{name:'Teacher',email:'teacher@school.test',role:'teacher'})).status,409);
 const teacherId=invite.data.id;
 const pendingUser=(await a.request('users')).data.users.find(user=>user.id===teacherId);assert.equal(pendingUser.password_ready,0);assert.equal(Object.hasOwn(pendingUser,'password_hash'),false);
 assert.equal((await teacher.request('login','POST',{email:'teacher@school.test',password:'anything'})).status,401);
 assert.equal((await teacher.request('reset-password','POST',{token:invite.data.resetToken,password:'teacher private password 123'})).status,200);
 assert.equal((await teacher.request('reset-password','POST',{token:invite.data.resetToken,password:'teacher private password 123'})).status,400);
 assert.equal((await teacher.request('login','POST',{email:'TEACHER@school.test',password:'teacher private password 123'})).status,200);
 assert.equal((await a.request('users')).data.users.find(user=>user.id===teacherId).password_ready,1);
 assert.equal((await teacher.request('users')).status,403);
 assert.equal((await teacher.request('auth-events')).status,403);
 assert.equal((await teacher.request('customers','POST',{name:'Blocked'})).status,403);
 assert.equal((await teacher.request('fees','POST',{})).status,403);
 assert.equal((await teacher.request('products','POST',{})).status,403);
 const student=await a.request('customers','POST',{name:'Student One',admission_no:'1',class_name:'5 A'});assert.equal(student.status,201);
 assert.equal((await a.request('fees','POST',{student_id:1,purpose:'Tuition',amount:10000,payment_date:'2026-10-16',method:'Cash'})).status,201);
 const redacted=(await teacher.request('state')).data;assert.equal(redacted.feeTotal,null);assert.deepEqual(redacted.fees,[]);assert.deepEqual(redacted.products,[]);assert.equal(redacted.customers.length,1);
 const attendance={date:'2026-10-16',records:[{student_id:1,status:'Present'}]};
 assert.equal((await teacher.request('attendance','POST',attendance,{'X-CSRF-Token':''})).status,403);
 assert.equal((await teacher.request('attendance','POST',attendance,{'X-CSRF-Token':'é'.repeat(64)})).status,403);
 assert.equal((await teacher.request('attendance','POST',attendance,{Origin:'https://evil.test'})).status,403);
 assert.equal((await teacher.request('attendance','POST',attendance)).status,200);
 const db=new DatabaseSync(f.path);
 const sessionRows=db.prepare('SELECT token_hash FROM auth_sessions').all();assert.ok(sessionRows.length>=2);assert.ok(sessionRows.every(row=>!a.cookie.includes(row.token_hash)));
 await f.stop();await f.start();assert.equal((await a.request('session')).data.authenticated,true);
 assert.equal((await a.request('users/'+teacherId,'PATCH',{role:'accountant',active:true})).status,200);
 assert.equal((await teacher.request('state')).status,401);
 assert.equal((await teacher.request('login','POST',{email:'teacher@school.test',password:'teacher private password 123'})).status,200);
 assert.equal((await teacher.request('attendance?date=2026-10-16')).status,403);
 assert.equal((await teacher.request('state')).data.feeTotal,10000);
 assert.equal((await teacher.request('change-password','POST',{currentPassword:'wrong',password:'new teacher password 123'})).status,400);
 assert.equal((await teacher.request('change-password','POST',{currentPassword:'teacher private password 123',password:'new teacher password 123'})).status,200);
 assert.equal((await a.request('users/'+teacherId,'PATCH',{role:'accountant',active:false})).status,200);
 assert.equal((await teacher.request('state')).status,401);
 assert.equal((await teacher.request('login','POST',{email:'teacher@school.test',password:'new teacher password 123'})).status,401);
 assert.equal((await a.request('users/1','PATCH',{role:'teacher',active:false})).status,400);
 assert.equal((await a.request('users/'+teacherId,'PATCH',{role:'teacher',active:true})).status,200);
 const reset=await a.request('users/'+teacherId+'/reset','POST',{});assert.equal(reset.status,200);
 db.prepare('UPDATE password_resets SET expires_at=0 WHERE user_id=?').run(teacherId);
 assert.equal((await teacher.request('reset-password','POST',{token:reset.data.resetToken,password:'another private password 123'})).status,400);
 assert.equal((await other.request('login','POST',{email:admin.email,password:admin.password})).status,200);
 assert.equal((await a.request('logout-all','POST',{})).status,200);
 assert.equal((await other.request('state')).status,401);assert.equal((await a.request('state')).status,401);
 assert.equal((await a.request('login','POST',{email:admin.email,password:admin.password})).status,200);
 db.prepare('UPDATE auth_sessions SET last_seen=0').run();assert.equal((await a.request('state')).status,401);
 for(let i=0;i<10;i++)assert.equal((await other.request('login','POST',{email:'missing@school.test',password:'incorrect password'})).status,401);
 assert.equal((await other.request('login','POST',{email:'missing@school.test',password:'incorrect password'})).status,429);
 db.close();
});
test('migration requires the old password and preserves school records',async t=>{
 const oldPassword='previous school password',salt='legacy-salt';
 const f=await fixture(t,db=>{
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT ''); INSERT INTO customers(name) VALUES('Existing student');");
  db.prepare('INSERT INTO settings VALUES(?,?)').run('password',salt+':'+scryptSync(oldPassword,salt,64).toString('hex'));
 });
 const a=f.client();assert.equal((await a.request('session')).data.migrationRequired,true);
 assert.equal((await a.request('setup','POST',admin)).status,401);
 assert.equal((await a.request('setup','POST',{...admin,currentPassword:oldPassword})).status,201);
 assert.equal((await a.request('state')).data.customers[0].name,'Existing student');
 const db=new DatabaseSync(f.path);assert.equal(db.prepare("SELECT 1 FROM settings WHERE key='password'").get(),undefined);db.close();
});

