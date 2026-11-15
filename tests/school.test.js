import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';

const admin={name:'Test Administrator',email:'admin@school.test',password:'administrator password 123'};
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function fixture(t,{demo=true,prepare,env={},skipSetup=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'school-suite-'));let processHandle;
 if(prepare){const db=new DatabaseSync(join(dir,'erp.sqlite'));prepare(db);db.close();}
 processHandle=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',ERP_DATA_DIR:dir,ERP_DEMO:demo?'1':'0',NODE_ENV:'test',...env},windowsHide:true});
 const base=await new Promise((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(Error('Startup timeout: '+error)),15000);processHandle.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});processHandle.stderr.on('data',chunk=>error+=chunk);processHandle.once('error',reject);processHandle.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+error));});});
 t.after(async()=>{if(processHandle.exitCode===null)await new Promise(resolve=>{processHandle.once('exit',resolve);processHandle.kill();});rmSync(dir,{recursive:true,force:true});});
 function client(initialCookie=''){
  let cookie=initialCookie,csrf='';
  return {async call(path,method='GET',data){const response=await fetch(base+'/api/'+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;return {status:response.status,data:result,headers:response.headers};}};
 }
 const a=client();if(!prepare&&!skipSetup)assert.equal((await a.call('setup','POST',admin)).status,201);
 async function account(role,student_ids){const c=client(),email=role+'-'+randomBytes(4).toString('hex')+'@school.test',password='private '+role+' password 123';const invitation=await a.call('users','POST',{name:'Test '+role,email,role,student_ids});assert.equal(invitation.status,201,JSON.stringify(invitation));assert.equal((await c.call('reset-password','POST',{token:invitation.data.resetToken,password})).status,200);assert.equal((await c.call('login','POST',{email,password})).status,200);return c;}
 return {a,client,account,base,dir};
}

test('demo school is complete, idempotent, and never overwrites existing records',async t=>{
 const f=await fixture(t),state=(await f.a.call('state')).data;
 assert.equal(state.customers.length,72);assert.equal(state.classes.length,8);assert.equal(state.staff.length,12);assert.equal(state.invoices.length,144);assert.equal(state.payroll.length,24);assert.equal(state.homework.length,16);assert.equal(state.submissions.length,24);assert.equal(state.routes.length,3);assert.equal(state.leaveRequests.length,2);
 assert.ok(state.attendanceSummary.length);assert.ok(state.loans.length);assert.ok(state.settings.demo_seed);
 assert.equal((await f.a.call('demo','POST',{})).status,201);assert.equal((await f.a.call('state')).data.customers.length,72);
 const backup=await f.a.call('backups','POST',{});assert.equal(backup.status,201);
 const snapshot=new DatabaseSync(join(f.dir,'backups',backup.data.filename),{readOnly:true});try{assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(snapshot.prepare('SELECT COUNT(*) n FROM customers').get().n,72);}finally{snapshot.close();}
 const empty=await fixture(t,{demo:false});await empty.a.call('customers','POST',{name:'Real Student'});assert.equal((await empty.a.call('demo','POST',{})).status,409);assert.equal((await empty.a.call('state')).data.customers.length,1);
});

test('production setup needs only administrator details, allows one winner, and uses Secure cookies',async t=>{
 const f=await fixture(t,{demo:false,skipSetup:true,env:{NODE_ENV:'production',ERP_ORIGIN:'https://school.test',ERP_SECURE_COOKIE:'1'}});
 const session=(await f.a.call('session')).data;assert.equal(session.setupRequired,true);assert.equal(Object.hasOwn(session,'setupTokenRequired'),false);
 const attempts=await Promise.all([f.a.call('setup','POST',admin),f.client().call('setup','POST',{...admin,email:'second@school.test'})]);
 assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);assert.match(attempts.find(r=>r.status===201).headers.get('set-cookie'),/; Secure/);
 assert.equal((await f.a.call('setup','POST',admin)).status,409);
 assert.equal((await f.a.call('session')).data.setupRequired,false);
});

test('admissions, capacity, student edits and archives are enforced',async t=>{
 const {a}=await fixture(t);
 const classResult=await a.call('classes','POST',{name:'9 A',room:'C-101',capacity:1,teacher_id:null});assert.equal(classResult.status,201);
 const application={name:'Applicant One',guardian:'Guardian',phone:'9000010000',class_name:'9 A',applied_on:day(),status:'Accepted',notes:'Test applicant'};
 const admitted=await a.call('admissions','POST',application);assert.equal(admitted.status,201);
 const enrolled=await a.call('admissions/'+admitted.data.id+'/enroll','POST',{admission_no:'NEW-001'});assert.equal(enrolled.status,200);
 assert.equal((await a.call('admissions/'+admitted.data.id+'/enroll','POST',{admission_no:'NEW-002'})).status,400);
 assert.equal((await a.call('customers','POST',{name:'Over Capacity',class_name:'9 A'})).status,400);
 assert.equal((await a.call('classes/'+classResult.data.id,'PATCH',{name:'9 B',room:'C-101',capacity:1,teacher_id:null})).status,400);
 assert.equal((await a.call('customers/'+enrolled.data.id,'PATCH',{status:'Archived'})).status,200);
 assert.equal((await a.call('attendance','POST',{date:day(),records:[{student_id:enrolled.data.id,status:'Present'}]})).status,400);
 const changed=(await a.call('state')).data.customers.find(s=>s.id===enrolled.data.id);assert.equal(changed.name,'Applicant One');assert.equal(changed.status,'Archived');
});

test('invoice payments are atomic and idempotent; voiding restores dues',async t=>{
 const {a}=await fixture(t);
 const invoice=await a.call('invoices','POST',{student_id:1,purpose:'Test charge',amount:100000,due_date:day(),academic_year:'2026–27'});assert.equal(invoice.status,201);
 const payment={student_id:1,purpose:'Test charge',amount:60000,payment_date:day(),method:'Cash',invoice_id:invoice.data.id,request_id:'same-request'};
 assert.equal((await a.call('fees','POST',{...payment,student_id:2})).status,400);
 const first=await a.call('fees','POST',payment),retry=await a.call('fees','POST',payment);assert.equal(first.status,201);assert.equal(first.data.id,retry.data.id);
 assert.equal((await a.call('fees','POST',{...payment,amount:1})).status,409);
 assert.equal((await a.call('fees','POST',{...payment,request_id:'overpay',amount:50000})).status,400);
 assert.equal((await a.call('invoices/'+invoice.data.id+'/cancel','POST',{})).status,400);
 assert.equal((await a.call('state')).data.invoices.find(i=>i.id===invoice.data.id).balance,40000);
 assert.equal((await a.call('fees/'+first.data.id+'/void','POST',{reason:'Entered against wrong receipt'})).status,200);
 assert.equal((await a.call('fees/'+first.data.id+'/void','POST',{reason:'Duplicate void'})).status,409);
 assert.equal((await a.call('state')).data.invoices.find(i=>i.id===invoice.data.id).balance,100000);
 assert.equal((await a.call('invoices/'+invoice.data.id+'/cancel','POST',{})).status,200);
 assert.equal((await a.call('fees','POST',{...payment,request_id:'cancelled'})).status,400);
});

test('timetable conflicts, book availability, and route seats cannot be bypassed',async t=>{
 const {a}=await fixture(t);
 const period={class_name:'1 A',day:'Saturday',start_time:'08:00',end_time:'09:00',subject:'Art',teacher_id:1,room:'Art-1'};
 assert.equal((await a.call('timetable','POST',period)).status,201);
 assert.equal((await a.call('timetable','POST',{...period,class_name:'2 A',room:'Art-2'})).status,400);
 assert.equal((await a.call('timetable','POST',{...period,teacher_id:2,room:'Art-3'})).status,400);
 assert.equal((await a.call('timetable','POST',{...period,class_name:'3 A',teacher_id:3})).status,400);
 assert.equal((await a.call('timetable','POST',{...period,start_time:'29:00'})).status,400);
 const book=await a.call('books','POST',{title:'One Copy',isbn:'ONE-COPY',author:'Test Author',category:'Test',copies:1});
 const loans=await Promise.all([a.call('loans','POST',{book_id:book.data.id,student_id:1,issued_on:day(),due_on:day()}),a.call('loans','POST',{book_id:book.data.id,student_id:2,issued_on:day(),due_on:day()})]);assert.deepEqual(loans.map(x=>x.status).sort(),[201,400]);
 const loan=loans.find(x=>x.status===201);assert.equal((await a.call('books/'+book.data.id,'PATCH',{title:'One Copy',isbn:'ONE-COPY',author:'Test',category:'Test',copies:0})).status,400);
 assert.equal((await a.call('loans/'+loan.data.id+'/return','POST',{})).status,200);assert.equal((await a.call('loans/'+loan.data.id+'/return','POST',{})).status,409);
 const route=await a.call('routes','POST',{name:'Single Seat',vehicle:'TEST-1',driver:'Test Driver',phone:'9000000000',capacity:1,stops:'Stop A\nStop B',monthly_fee:100000});
 assert.equal((await a.call('transport','POST',{student_id:70,route_id:route.data.id,stop:'Unknown'})).status,400);
 assert.equal((await a.call('transport','POST',{student_id:70,route_id:route.data.id,stop:'Stop A'})).status,201);
 const routeUpdate={name:'Single Seat',vehicle:'TEST-1',driver:'Test Driver',phone:'9000000000',capacity:1,stops:'Stop B',monthly_fee:100000};
 assert.equal((await a.call('routes/'+route.data.id,'PATCH',routeUpdate)).status,400,'Assigned boarding stops must remain on the route');
 assert.equal((await a.call('routes/'+route.data.id,'PATCH',{...routeUpdate,stops:'Stop A\nStop B\nStop C'})).status,200);
 assert.equal((await a.call('transport','POST',{student_id:71,route_id:route.data.id,stop:'Stop A'})).status,400);
 assert.equal((await a.call('customers/70','PATCH',{status:'Archived'})).status,200);
 assert.equal((await a.call('state')).data.routes.find(r=>r.id===route.data.id).assigned,0);
});

test('exam marks are atomic and published results are locked',async t=>{
 const {a}=await fixture(t),state=(await a.call('state')).data,students=state.customers.filter(s=>s.class_name==='1 A');
 const exam=await a.call('exams','POST',{name:'New test',class_name:'1 A',subject:'Science',exam_date:day(),max_marks:50,status:'Scheduled'}),id=exam.data.id;
 assert.equal((await a.call('exams/'+id+'/marks','POST',{marks:[{student_id:students[0].id,marks:40},{student_id:students[1].id,marks:60}]})).status,400);
 assert.equal((await a.call('state')).data.marks.filter(m=>m.exam_id===id).length,0);
 assert.equal((await a.call('exams/'+id,'PATCH',{name:'New test',class_name:'1 A',subject:'Science',exam_date:day(),max_marks:50,status:'Published'})).status,400);
 assert.equal((await a.call('exams/'+id+'/marks','POST',{marks:students.map(s=>({student_id:s.id,marks:40,remarks:'Good'}))})).status,200);
 assert.equal((await a.call('exams/'+id,'PATCH',{name:'New test',class_name:'1 A',subject:'Science',exam_date:day(),max_marks:50,status:'Published'})).status,200);
 assert.equal((await a.call('exams/'+id+'/marks','POST',{marks:[{student_id:students[0].id,marks:49}]})).status,400);
});

test('family portals restrict all records and homework to linked students',async t=>{
 const f=await fixture(t);
 assert.equal((await f.a.call('users','POST',{name:'No links',email:'nolinks@school.test',role:'parent'})).status,400);
 assert.equal((await f.a.call('users','POST',{name:'Two students',email:'twostudents@school.test',role:'student',student_ids:[1,2]})).status,400);
 const student=await f.account('student',[2]),parent=await f.account('parent',[2,10]),teacher=await f.account('teacher');
 const state=(await student.call('state')).data;
 assert.deepEqual(state.customers.map(s=>s.id),[2]);assert.deepEqual(state.staff,[]);assert.deepEqual(state.expenses,[]);assert.deepEqual(state.payroll,[]);assert.deepEqual(state.activity,[]);
 assert.ok(state.invoices.length);assert.ok(state.invoices.every(i=>i.student_id===2));assert.ok(state.fees.every(f=>f.student_id===2));assert.ok(state.attendance.every(a=>a.student_id===2));assert.ok(state.marks.every(m=>m.student_id===2));assert.ok(state.submissions.every(s=>s.student_id===2));assert.ok(state.timetable.length);assert.ok(state.timetable.every(p=>p.class_name==='1 A'));assert.ok(state.notices.every(n=>['Students','School community'].includes(n.audience)));
 assert.deepEqual((await parent.call('state')).data.customers.map(s=>s.id).sort((a,b)=>a-b),[2,10]);
 for(const path of ['users','auth-events','attendance?date='+day()])assert.equal((await student.call(path)).status,403);
 assert.equal((await student.call('fees','POST',{})).status,403);assert.equal((await student.call('settings','PATCH',{})).status,403);
 assert.ok((await teacher.call('state')).data.staff.every(s=>!Object.hasOwn(s,'base_salary')));assert.equal((await teacher.call('payroll','POST',{})).status,403);
 const homework=state.homework.find(h=>h.subject==='English');
 assert.equal((await student.call('homework/'+homework.id+'/submit','POST',{student_id:3,answer:'Another student'})).status,403);
 assert.equal((await parent.call('homework/'+homework.id+'/submit','POST',{student_id:2,answer:'Parent attempt'})).status,403);
 assert.equal((await student.call('homework/'+homework.id+'/submit','POST',{student_id:2,answer:'My own answer.'})).status,200);
 assert.equal((await teacher.call('homework/'+homework.id+'/grade','POST',{student_id:2,score:homework.max_marks+1,feedback:'Invalid'})).status,400);
 assert.equal((await teacher.call('homework/'+homework.id+'/grade','POST',{student_id:2,score:20,feedback:'Well written.'})).status,200);
 assert.equal((await student.call('homework/'+homework.id+'/submit','POST',{student_id:2,answer:'Change graded work'})).status,400);
 assert.equal((await student.call('state')).data.submissions.find(s=>s.homework_id===homework.id).score,20);
});

test('leave approvals enforce ownership and prevent overlapping requests',async t=>{
 const f=await fixture(t),parent=await f.account('parent',[2]),teacher=await f.account('teacher');
 const leave={student_id:2,from_date:'2027-02-01',to_date:'2027-02-02',reason:'Family event'};
 assert.equal((await parent.call('leave','POST',{...leave,student_id:3})).status,403);
 const request=await parent.call('leave','POST',leave);assert.equal(request.status,201);
 assert.equal((await parent.call('leave','POST',leave)).status,400);
 assert.equal((await parent.call('leave/'+request.data.id+'/review','POST',{status:'Approved'})).status,403);
 assert.equal((await f.a.call('leave/'+request.data.id+'/review','POST',{status:'Approved',review_note:'Approved by the school.'})).status,200);
 assert.equal((await teacher.call('state')).data.leaveRequests.length,0);
 assert.equal((await parent.call('state')).data.leaveRequests[0].status,'Approved');
 const own=await f.a.call('leave','POST',{from_date:'2027-03-01',to_date:'2027-03-02',reason:'Personal leave'});
 assert.equal((await f.a.call('leave/'+own.data.id+'/review','POST',{status:'Approved'})).status,400);
});

test('payroll payments create exactly one salary expense and paid records cannot change',async t=>{
 const f=await fixture(t),accountant=await f.account('accountant'),state=(await f.a.call('state')).data,row=state.payroll.find(p=>p.status==='Draft'),before=state.expenses.length;
 assert.equal((await accountant.call('payroll/generate','POST',{month:day().slice(0,7)})).data.count,0);
 assert.equal((await accountant.call('payroll/'+row.id,'PATCH',{staff_id:row.staff_id,month:row.month,basic:100,allowances:0,deductions:101})).status,400);
 const payment={paid_on:day(),method:'Bank transfer',reference:'SALARY-TEST'};
 assert.equal((await accountant.call('payroll/'+row.id+'/pay','POST',payment)).status,200);
 assert.equal((await accountant.call('payroll/'+row.id+'/pay','POST',payment)).status,409);
 const after=(await f.a.call('state')).data;assert.equal(after.expenses.length,before+1);assert.equal(after.expenses.find(e=>e.reference.includes('SALARY-TEST')).amount,row.net);
 assert.equal((await accountant.call('payroll/'+row.id,'PATCH',{staff_id:row.staff_id,month:row.month,basic:100,allowances:0,deductions:0})).status,400);
 assert.equal((await accountant.call('settings','PATCH',{})).status,403);
});

test('upgrading existing accounts preserves their sessions and creates a consistent snapshot',async t=>{
 const raw=randomBytes(32).toString('hex'),now=Date.now(),hash=value=>createHash('sha256').update(value).digest('hex');
 const f=await fixture(t,{demo:false,prepare:db=>{
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT,role TEXT NOT NULL CHECK(role IN('admin','teacher','accountant')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))); CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL); INSERT INTO users(id,name,email,password_hash,role) VALUES(7,'Existing Admin','existing@school.test','existing-hash','admin');");
  db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run(hash(raw),7,randomBytes(32).toString('hex'),now,now,now+3600000);
 }});
 const client=f.client('erp_session='+raw),session=await client.call('session');assert.equal(session.data.authenticated,true);assert.equal(session.data.user.id,7);assert.equal((await client.call('state')).status,200);
 const db=new DatabaseSync(join(f.dir,'erp.sqlite'),{readOnly:true});try{assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT email FROM users WHERE id=7').get().email,'existing@school.test');}finally{db.close();}
 assert.ok(readdirSync(join(f.dir,'backups')).some(name=>name.startsWith('before-portal-upgrade-')));
});
