import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {seedSchoolDemo} from './demo.js';
import {createExtensions} from './extensions.js';

export function createSchool(db,auth,dataDir){
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 const text=(value,label,max=160)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(`${label} is required (up to ${max} characters).`);return value.trim();};
 const optional=(value,label,max=160)=>value===undefined||value===''?'':text(value,label,max);
 const num=(value,label,min=0,max=100000000)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(`Enter a valid ${label}.`);return value;};
 const choice=(value,values,label)=>{if(!values.includes(value))fail(`Choose a valid ${label}.`);return value;};
 const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('Choose a valid date.');return value;};
 const mail=value=>{const result=optional(value,'Email',254);if(result&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail('Enter a valid email address.');return result;};
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let transactionDepth=0;
 const transaction=fn=>{if(transactionDepth)return fn();db.exec('BEGIN IMMEDIATE');transactionDepth++;try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}finally{transactionDepth--;}};
 const get=(table,id)=>{num(id,'record ID',1);const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);if(!row)fail('Record not found.',404);return row;};
 const audit=(account,action,entity,id,detail='')=>db.prepare('INSERT INTO school_events(user_id,action,entity,record_id,detail) VALUES(?,?,?,?,?)').run(account.user_id,action,entity,id,detail);
 const addColumn=(table,name,definition)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);};
 if(db.prepare('PRAGMA user_version').get().user_version<2){
  mkdirSync(resolve(dataDir,'backups'),{recursive:true});
  db.prepare('VACUUM INTO ?').run(resolve(dataDir,'backups','before-school-upgrade-'+randomUUID()+'.sqlite'));
 }
 db.exec(`
 CREATE TABLE IF NOT EXISTS staff(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',designation TEXT NOT NULL,department TEXT NOT NULL,joined_on TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
 CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,teacher_id INTEGER REFERENCES staff(id),room TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 200));
 CREATE TABLE IF NOT EXISTS admissions(id INTEGER PRIMARY KEY,name TEXT NOT NULL,guardian TEXT NOT NULL,phone TEXT NOT NULL,class_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Inquiry' CHECK(status IN('Inquiry','Interview','Accepted','Declined','Enrolled')),notes TEXT NOT NULL DEFAULT '',applied_on TEXT NOT NULL,student_id INTEGER REFERENCES customers(id));
 CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES customers(id),purpose TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),due_date TEXT NOT NULL,academic_year TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Cancelled')),created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,category TEXT NOT NULL,payee TEXT NOT NULL,description TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),payment_date TEXT NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS exams(id INTEGER PRIMARY KEY,name TEXT NOT NULL,class_name TEXT NOT NULL,subject TEXT NOT NULL,exam_date TEXT NOT NULL,max_marks INTEGER NOT NULL CHECK(max_marks BETWEEN 1 AND 1000),status TEXT NOT NULL DEFAULT 'Scheduled' CHECK(status IN('Scheduled','Published')));
 CREATE TABLE IF NOT EXISTS marks(exam_id INTEGER NOT NULL REFERENCES exams(id),student_id INTEGER NOT NULL REFERENCES customers(id),marks INTEGER NOT NULL CHECK(marks>=0),remarks TEXT NOT NULL DEFAULT '',PRIMARY KEY(exam_id,student_id));
 CREATE TABLE IF NOT EXISTS timetable(id INTEGER PRIMARY KEY,class_name TEXT NOT NULL,day TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,subject TEXT NOT NULL,teacher_id INTEGER NOT NULL REFERENCES staff(id),room TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY,isbn TEXT NOT NULL UNIQUE,title TEXT NOT NULL,author TEXT NOT NULL,category TEXT NOT NULL,copies INTEGER NOT NULL CHECK(copies>=0));
 CREATE TABLE IF NOT EXISTS loans(id INTEGER PRIMARY KEY,book_id INTEGER NOT NULL REFERENCES books(id),student_id INTEGER NOT NULL REFERENCES customers(id),issued_on TEXT NOT NULL,due_on TEXT NOT NULL,returned_on TEXT);
 CREATE TABLE IF NOT EXISTS routes(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,vehicle TEXT NOT NULL,driver TEXT NOT NULL,phone TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 100),stops TEXT NOT NULL,monthly_fee INTEGER NOT NULL CHECK(monthly_fee>=0));
 CREATE TABLE IF NOT EXISTS transport_assignments(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL UNIQUE REFERENCES customers(id),route_id INTEGER NOT NULL REFERENCES routes(id),stop TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN('All staff','Teachers','Accounts staff','Administrators','Parents','Students','School community')),published_on TEXT NOT NULL,expires_on TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS school_events(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT NOT NULL,entity TEXT NOT NULL,record_id INTEGER,detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE INDEX IF NOT EXISTS attendance_date ON attendance(date);
 CREATE INDEX IF NOT EXISTS invoices_student ON invoices(student_id,status);
 CREATE INDEX IF NOT EXISTS loans_active ON loans(book_id,returned_on);
 CREATE INDEX IF NOT EXISTS timetable_day ON timetable(day,start_time);
 CREATE INDEX IF NOT EXISTS exams_class ON exams(class_name,exam_date);
 `);
 for(const [name,definition] of Object.entries({status:"TEXT NOT NULL DEFAULT 'Active'",dob:"TEXT NOT NULL DEFAULT ''",gender:"TEXT NOT NULL DEFAULT ''",address:"TEXT NOT NULL DEFAULT ''",admitted_on:"TEXT NOT NULL DEFAULT ''",roll_no:"TEXT NOT NULL DEFAULT ''"}))addColumn('customers',name,definition);
 addColumn('fees','invoice_id','INTEGER REFERENCES invoices(id)');
 addColumn('fees','void_reason',"TEXT NOT NULL DEFAULT ''");
 addColumn('fees','request_key','TEXT');
 addColumn('products','active','INTEGER NOT NULL DEFAULT 1');
 db.exec('CREATE INDEX IF NOT EXISTS fees_invoice ON fees(invoice_id); CREATE UNIQUE INDEX IF NOT EXISTS fees_request_key ON fees(request_key) WHERE request_key IS NOT NULL; PRAGMA user_version=2;');
 const defaults={school_name:'Shambhu Dayal Global School',school_address:'Ghaziabad, Uttar Pradesh',school_phone:'+91 120 555 0100',school_email:'office@sdglobalschool.example',academic_year:'2026–27',principal:'Dr. Meera Kapoor'};
 for(const [key,value]of Object.entries(defaults))db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key,value);
 const settings=()=>Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key LIKE 'school_%' OR key IN('academic_year','principal','demo_seed')").all().map(r=>[r.key,r.value]));
 const invoiceRows=()=>db.prepare(`SELECT i.*,c.name student,c.class_name,c.admission_no,COALESCE(SUM(CASE WHEN f.void_reason='' THEN f.amount ELSE 0 END),0) paid,i.amount-COALESCE(SUM(CASE WHEN f.void_reason='' THEN f.amount ELSE 0 END),0) balance FROM invoices i JOIN customers c ON c.id=i.student_id LEFT JOIN fees f ON f.invoice_id=i.id GROUP BY i.id ORDER BY i.due_date,i.id`).all();
 function state(account){
  const can=p=>auth.permissions(account).includes(p);
  return {
   settings:settings(),classes:db.prepare('SELECT c.*,s.name teacher,(SELECT COUNT(*) FROM customers x WHERE x.class_name=c.name AND x.status=\'Active\') students FROM classes c LEFT JOIN staff s ON s.id=c.teacher_id ORDER BY c.id').all(),
   staff:can('staff:read')?db.prepare('SELECT * FROM staff ORDER BY name').all().map(s=>{if(!can('payroll:read')){const {base_salary,...safe}=s;return safe;}return s;}):[],
   admissions:can('students:write')?db.prepare('SELECT * FROM admissions ORDER BY id DESC').all():[],
   invoices:can('fees:read')?invoiceRows():[],expenses:can('fees:read')?db.prepare('SELECT * FROM expenses ORDER BY payment_date DESC,id DESC').all():[],
   exams:can('academics:read')?db.prepare('SELECT e.*,(SELECT COUNT(*) FROM marks m WHERE m.exam_id=e.id) marked FROM exams e ORDER BY exam_date DESC').all():[],
   marks:can('academics:read')?db.prepare('SELECT * FROM marks').all():[],
   timetable:can('classes:read')?db.prepare('SELECT t.*,s.name teacher FROM timetable t JOIN staff s ON s.id=t.teacher_id ORDER BY start_time,id').all():[],
   books:can('library:read')?db.prepare('SELECT b.*,b.copies-(SELECT COUNT(*) FROM loans l WHERE l.book_id=b.id AND l.returned_on IS NULL) available FROM books b ORDER BY title').all():[],
   loans:can('library:read')?db.prepare('SELECT l.*,b.title,c.name student,c.class_name FROM loans l JOIN books b ON b.id=l.book_id JOIN customers c ON c.id=l.student_id ORDER BY l.id DESC').all():[],
   routes:can('transport:read')?db.prepare('SELECT r.*,(SELECT COUNT(*) FROM transport_assignments a WHERE a.route_id=r.id) assigned FROM routes r ORDER BY name').all():[],
   transport:can('transport:read')?db.prepare('SELECT a.*,c.name student,c.class_name,r.name route,r.vehicle FROM transport_assignments a JOIN customers c ON c.id=a.student_id JOIN routes r ON r.id=a.route_id ORDER BY c.name').all():[],
   notices:db.prepare('SELECT * FROM notices ORDER BY published_on DESC,id DESC').all().filter(n=>can('notices:write')||(n.published_on<=today()&&n.expires_on>=today()&&['School community',...(['parent','student'].includes(account.role)?[]:['All staff']),{admin:'Administrators',teacher:'Teachers',accountant:'Accounts staff',parent:'Parents',student:'Students'}[account.role]].includes(n.audience))),
   attendanceSummary:can('attendance:read')?db.prepare('SELECT date,status,COUNT(*) count FROM attendance GROUP BY date,status ORDER BY date DESC LIMIT 300').all():[],
   attendanceByClass:can('attendance:read')?db.prepare('SELECT a.date,a.status,c.class_name,COUNT(*) count FROM attendance a JOIN customers c ON c.id=a.student_id GROUP BY a.date,a.status,c.class_name ORDER BY a.date DESC LIMIT 3000').all():[],
   activity:account.role==='admin'?db.prepare('SELECT e.*,u.name actor FROM school_events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 100').all():[],...extensions.state(account)
  };
 }
 const activeStudent=id=>{const row=get('customers',id);if(row.status!=='Active')fail('This student is archived.');return row;};
 function payFee(d,account){return transaction(()=>{
  num(d.student_id,'student',1);if(!db.prepare('SELECT 1 FROM customers WHERE id=?').get(d.student_id))fail('Student not found.');activeStudent(d.student_id);
  const amount=num(d.amount,'payment amount',1),payment_date=date(d.payment_date),method=choice(d.method,['Cash','UPI','Bank transfer','Card','Cheque'],'payment method'),purpose=text(d.purpose,'Fee description');
  if(payment_date>today())fail('Payment date cannot be in the future.');
  const request_key=d.request_id?text(d.request_id,'Request ID',80):null;
  if(request_key){const old=db.prepare('SELECT * FROM fees WHERE request_key=?').get(request_key);if(old){if(old.student_id!==d.student_id||old.amount!==amount||old.invoice_id!==(d.invoice_id||null)||old.purpose!==purpose||old.payment_date!==payment_date||old.method!==method)fail('This request ID was already used for another payment.',409);return {id:old.id};}}
  const invoice_id=d.invoice_id?num(d.invoice_id,'invoice',1):null;
  if(invoice_id){const invoice=get('invoices',invoice_id);if(invoice.student_id!==d.student_id||invoice.status!=='Open')fail('Choose an open invoice for this student.');const paid=db.prepare("SELECT COALESCE(SUM(amount),0) paid FROM fees WHERE invoice_id=? AND void_reason=''").get(invoice_id).paid;if(amount>invoice.amount-paid)fail('Payment exceeds the remaining invoice balance.');}
  const payment=save('fees',0,{student_id:d.student_id,purpose,amount,payment_date,method,invoice_id,request_key},account);return payment;
 });}
 const classRecord=value=>{const label=text(value,'Class',40);if(!db.prepare('SELECT 1 FROM classes WHERE name=?').get(label))fail('Choose an existing class.');return label;};
 function createStudent(d,account){
  const status=choice(d.status??'Active',['Active','Archived'],'student status');
  const class_name=optional(d.class_name,'Class',40);
  const classInfo=db.prepare('SELECT * FROM classes WHERE name=?').get(class_name);
  if(db.prepare('SELECT 1 FROM classes LIMIT 1').get()&&!classInfo)fail('Choose an existing class.');
  if(status==='Active'&&classInfo&&db.prepare("SELECT COUNT(*) n FROM customers WHERE class_name=? AND status='Active'").get(class_name).n>=classInfo.capacity)fail('This class is full.');
  const dob=d.dob?date(d.dob):'';if(dob&&dob>today())fail('Date of birth cannot be in the future.');
  return save('customers',0,{name:text(d.name,'Student name'),admission_no:optional(d.admission_no,'Admission number',40),class_name,guardian:optional(d.guardian,'Guardian'),email:mail(d.email),phone:optional(d.phone,'Phone',40),dob,status,gender:choice(d.gender||'',['','Female','Male','Other'],'gender'),address:optional(d.address,'Address',500),admitted_on:d.admitted_on?date(d.admitted_on):today(),roll_no:optional(d.roll_no,'Roll number',30)},account);
 }
 function save(table,id,fields,account){
  return transaction(()=>{
   const isUpdate=Boolean(id);
   if(id)get(table,id);
   const names=Object.keys(fields),values=Object.values(fields);
   if(id)db.prepare(`UPDATE ${table} SET ${names.map(n=>n+'=?').join(',')} WHERE id=?`).run(...values,id);
   else id=Number(db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...values).lastInsertRowid);
   audit(account,isUpdate?'updated':'created',table,id,names.join(', '));return {id};
  });
 }
 async function route(path,req,res,body,send,account){
  if(await extensions.route(path,req,res,body,send,account))return true;
  const match=path.match(/^\/api\/(classes|staff|admissions|invoices|expenses|exams|timetable|books|loans|routes|transport|notices|settings|backups|demo)(?:\/(\d+))?(?:\/(enroll|marks|return|cancel))?$/);
  const studentMatch=path.match(/^\/api\/customers\/(\d+)$/),voidMatch=path.match(/^\/api\/fees\/(\d+)\/void$/),productMatch=req.method==='PATCH'&&path.match(/^\/api\/products\/(\d+)$/);
  if(!match&&!studentMatch&&!voidMatch&&!productMatch)return false;
  const kind=match?.[1],id=Number(match?.[2]||studentMatch?.[1]||voidMatch?.[1]||productMatch?.[1]||0),action=match?.[3],method=req.method;
  const permission=studentMatch?'students:write':voidMatch?'fees:write':productMatch?'supplies:write':({classes:'classes:write',staff:'staff:write',admissions:'students:write',invoices:'fees:write',expenses:'fees:write',exams:'academics:write',timetable:'classes:write',books:'library:write',loans:'library:write',routes:'transport:write',transport:'transport:write',notices:'notices:write',settings:'settings:write',backups:'settings:write',demo:'settings:write'}[kind]);
  auth.allow(account,permission);
  if(!['POST','PATCH','DELETE'].includes(method))fail('Method not allowed.',405);
  if((['PATCH','DELETE'].includes(method)&&!id&&kind!=='settings')||(action&&!id))fail('Record ID is required.');
  const d=await body(req);account=auth.requireSession(req);auth.csrf(req,account);auth.allow(account,permission);
  let result;
  if(studentMatch&&method==='PATCH'){
   const original=get('customers',id),status=choice(d.status??original.status,['Active','Archived'],'student status');
   const class_name=d.class_name===undefined?original.class_name:classRecord(d.class_name);
   if(status==='Active'&&(class_name!==original.class_name||original.status!=='Active')){
    const room=db.prepare('SELECT capacity FROM classes WHERE name=?').get(class_name);
    const count=db.prepare("SELECT COUNT(*) n FROM customers WHERE class_name=? AND status='Active' AND id<>?").get(class_name,id).n;
    if(room&&count>=room.capacity)fail('This class is full.');
   }
   const fields={name:text(d.name??original.name,'Student name'),admission_no:text(d.admission_no??original.admission_no,'Admission number',40),class_name,guardian:text(d.guardian??original.guardian,'Guardian'),email:mail(d.email??original.email),phone:optional(d.phone??original.phone,'Phone',40),status,dob:d.dob?date(d.dob):original.dob,gender:choice(d.gender??original.gender,['','Female','Male','Other'],'gender'),address:optional(d.address??original.address,'Address',500),admitted_on:d.admitted_on?date(d.admitted_on):original.admitted_on,roll_no:optional(d.roll_no??original.roll_no,'Roll number',30)};
   if(fields.dob&&fields.dob>today())fail('Date of birth cannot be in the future.');
   result=transaction(()=>{const saved=save('customers',id,fields,account);if(status==='Archived')db.prepare('DELETE FROM transport_assignments WHERE student_id=?').run(id);return saved;});
  }else if(productMatch){
   result=save('products',id,{name:text(d.name,'Item name'),sku:text(d.sku,'Item code',50),price:num(d.price,'price'),stock:num(d.stock,'stock'),active:d.active===false?0:1},account);
  }else if(voidMatch&&method==='POST'){
   const fee=get('fees',id);if(fee.void_reason)fail('This receipt has already been voided.',409);
   result=save('fees',id,{void_reason:text(d.reason,'Reason for voiding',500)},account);
  }else if(kind==='settings'&&method==='PATCH'){
   const fields={school_name:text(d.school_name,'School name'),school_address:text(d.school_address,'School address',500),school_phone:text(d.school_phone,'Phone',40),school_email:mail(d.school_email),academic_year:text(d.academic_year,'Academic year',30),principal:text(d.principal,'Principal name')};
   result=transaction(()=>{for(const [key,value]of Object.entries(fields))db.prepare('UPDATE settings SET value=? WHERE key=?').run(value,key);audit(account,'updated','settings',null);return {ok:true};});
  }else if(kind==='backups'&&method==='POST'){
   let filename;
   if(db.createBackup)filename=await db.createBackup();
   else{mkdirSync(resolve(dataDir,'backups'),{recursive:true});filename='school-'+today()+'-'+randomUUID()+'.sqlite';db.prepare('VACUUM INTO ?').run(resolve(dataDir,'backups',filename));}
   audit(account,'created','backup',null,filename);result={filename,storage:db.createBackup?'mongodb':'sqlite'};
  }else if(kind==='demo'&&method==='POST'){
   seedDemo();audit(account,'loaded','demo',null);result={ok:true};
  }else if(kind==='classes'&&['POST','PATCH'].includes(method)){
   const teacher_id=d.teacher_id?num(d.teacher_id,'teacher',1):null;if(teacher_id&&!get('staff',teacher_id).active)fail('Choose an active teacher.');
   const label=text(d.name,'Class name',40),capacity=num(d.capacity,'capacity',1,200);
   if(id&&label!==get('classes',id).name)fail('Class names cannot change after creation. Create a new class and transfer students.');
   if(db.prepare("SELECT COUNT(*) n FROM customers WHERE class_name=? AND status='Active'").get(label).n>capacity)fail('Capacity cannot be below the current enrolment.');
   result=save('classes',id,{name:label,teacher_id,room:text(d.room,'Room',40),capacity},account);
  }else if(kind==='staff'&&['POST','PATCH'].includes(method)){
   if(d.active!==undefined&&typeof d.active!=='boolean')fail('Choose an employment status.');
   if(id&&d.active===false&&(db.prepare('SELECT 1 FROM classes WHERE teacher_id=?').get(id)||db.prepare('SELECT 1 FROM timetable WHERE teacher_id=?').get(id)))fail('Reassign this staff member’s classes and timetable before making them inactive.');
   result=save('staff',id,{name:text(d.name,'Full name'),email:mail(d.email),phone:optional(d.phone,'Phone',40),designation:text(d.designation,'Designation',80),department:text(d.department,'Department',80),joined_on:date(d.joined_on),active:d.active===false?0:1,base_salary:num(d.base_salary??(id?get('staff',id).base_salary:0),'monthly basic salary')},account);
  }else if(kind==='admissions'&&action==='enroll'&&method==='POST'){
   result=transaction(()=>{
    const application=get('admissions',id);if(application.status!=='Accepted')fail('Accept the application before enrolling the student.');
    const class_name=classRecord(application.class_name),room=db.prepare('SELECT * FROM classes WHERE name=?').get(class_name);
    if(db.prepare("SELECT COUNT(*) n FROM customers WHERE class_name=? AND status='Active'").get(class_name).n>=room.capacity)fail('This class is full.');
    const student=save('customers',0,{name:application.name,guardian:application.guardian,phone:application.phone,class_name,admission_no:text(d.admission_no,'Admission number',40),admitted_on:today()},account);
    db.prepare("UPDATE admissions SET status='Enrolled',student_id=? WHERE id=?").run(student.id,id);audit(account,'enrolled','admissions',id);return student;
   });
  }else if(kind==='admissions'&&['POST','PATCH'].includes(method)){
   if(id&&get('admissions',id).status==='Enrolled')fail('This application is already enrolled. Edit the student record instead.');
   result=save('admissions',id,{name:text(d.name,'Student name'),guardian:text(d.guardian,'Guardian'),phone:text(d.phone,'Phone',40),class_name:classRecord(d.class_name),status:choice(d.status,['Inquiry','Interview','Accepted','Declined'],'application status'),notes:optional(d.notes,'Notes',2000),applied_on:date(d.applied_on)},account);
  }else if(kind==='invoices'&&action==='cancel'&&method==='POST'){
   const invoice=get('invoices',id);if(invoice.status==='Cancelled')fail('Invoice already cancelled.',409);
   if(db.prepare("SELECT 1 FROM fees WHERE invoice_id=? AND void_reason='' LIMIT 1").get(id))fail('Void the linked receipts before cancelling this invoice.');
   result=save('invoices',id,{status:'Cancelled'},account);
  }else if(kind==='invoices'&&method==='POST'&&!id){
   activeStudent(d.student_id);result=save('invoices',0,{student_id:d.student_id,purpose:text(d.purpose,'Fee description'),amount:num(d.amount,'invoice amount',1),due_date:date(d.due_date),academic_year:text(d.academic_year,'Academic year',30)},account);
  }else if(kind==='expenses'&&method==='POST'&&!id){
   result=save('expenses',0,{category:choice(d.category,['Salaries','Utilities','Supplies','Maintenance','Transport','Other'],'expense category'),payee:text(d.payee,'Payee'),description:text(d.description,'Description',500),amount:num(d.amount,'amount',1),payment_date:date(d.payment_date),method:choice(d.method,['Cash','UPI','Bank transfer','Card','Cheque'],'payment method'),reference:optional(d.reference,'Reference',100)},account);
  }else if(kind==='exams'&&action==='marks'&&method==='POST'){
   const exam=get('exams',id);if(exam.status==='Published')fail('Reopen this exam before changing marks.');
   if(!Array.isArray(d.marks)||!d.marks.length||d.marks.length>200)fail('Enter marks for at least one student (maximum 200).');
   result=transaction(()=>{const seen=new Set();for(const m of d.marks){const student=activeStudent(m.student_id);if(student.class_name!==exam.class_name)fail('Student does not belong to this exam class.');if(seen.has(student.id))fail('Duplicate student in marks.');seen.add(student.id);db.prepare('INSERT INTO marks VALUES(?,?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET marks=excluded.marks,remarks=excluded.remarks').run(id,student.id,num(m.marks,'marks',0,exam.max_marks),optional(m.remarks,'Remarks',300));}audit(account,'marks_saved','exams',id);return {ok:true};});
  }else if(kind==='exams'&&['POST','PATCH'].includes(method)){
   const status=choice(d.status,['Scheduled','Published'],'exam status'),class_name=classRecord(d.class_name),max_marks=num(d.max_marks,'maximum marks',1,1000);
   if(id){const old=get('exams',id);if(db.prepare('SELECT 1 FROM marks WHERE exam_id=?').get(id)&&(old.class_name!==class_name||old.max_marks!==max_marks))fail('Class and maximum marks cannot change after marks are entered.');}
   if(status==='Published'){
    const enrolled=db.prepare("SELECT COUNT(*) n FROM customers WHERE class_name=? AND status='Active'").get(class_name).n;
    const marked=id?db.prepare("SELECT COUNT(*) n FROM marks m JOIN customers c ON c.id=m.student_id WHERE m.exam_id=? AND c.class_name=? AND c.status='Active'").get(id,class_name).n:0;
    if(!enrolled||marked!==enrolled)fail('Enter marks for every active student before publishing results.');
   }
   result=save('exams',id,{name:text(d.name,'Exam name',100),class_name,subject:text(d.subject,'Subject',80),exam_date:date(d.exam_date),max_marks,status},account);
  }else if(kind==='timetable'&&['POST','PATCH'].includes(method)){
   const class_name=classRecord(d.class_name),day=choice(d.day,['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],'day'),start_time=text(d.start_time,'Start time',5),end_time=text(d.end_time,'End time',5),teacher_id=num(d.teacher_id,'teacher',1),room=text(d.room,'Room',40);
   if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time)||end_time<=start_time)fail('End time must be after a valid start time.');
   if(!get('staff',teacher_id).active)fail('Choose an active teacher.');
   if(db.prepare('SELECT 1 FROM timetable WHERE id<>? AND day=? AND start_time<? AND end_time>? AND (class_name=? OR teacher_id=? OR room=?)').get(id,day,end_time,start_time,class_name,teacher_id,room))fail('This period conflicts with the class, teacher, or room timetable.');
   result=save('timetable',id,{class_name,day,start_time,end_time,subject:text(d.subject,'Subject',80),teacher_id,room},account);
  }else if(kind==='timetable'&&method==='DELETE'&&id){get('timetable',id);result=transaction(()=>{db.prepare('DELETE FROM timetable WHERE id=?').run(id);audit(account,'deleted',kind,id);return {ok:true};});
  }else if(kind==='books'&&['POST','PATCH'].includes(method)){
   const copies=num(d.copies,'copies',0,10000),borrowed=id?db.prepare('SELECT COUNT(*) n FROM loans WHERE book_id=? AND returned_on IS NULL').get(id).n:0;if(copies<borrowed)fail('Copies cannot be below the number currently on loan.');
   result=save('books',id,{isbn:text(d.isbn,'ISBN / accession number',40),title:text(d.title,'Book title'),author:text(d.author,'Author'),category:text(d.category,'Category',80),copies},account);
  }else if(kind==='loans'&&action==='return'&&method==='POST'){
   const loan=get('loans',id);if(loan.returned_on)fail('This book has already been returned.',409);result=save('loans',id,{returned_on:today()},account);
  }else if(kind==='loans'&&method==='POST'&&!id){
   result=transaction(()=>{const book=get('books',d.book_id);activeStudent(d.student_id);const issued_on=date(d.issued_on),due_on=date(d.due_on);if(due_on<issued_on||issued_on>today())fail('Choose valid issue and due dates.');
    if(book.copies<=db.prepare('SELECT COUNT(*) n FROM loans WHERE book_id=? AND returned_on IS NULL').get(book.id).n)fail('No copies of this book are available.');
    if(db.prepare('SELECT 1 FROM loans WHERE book_id=? AND student_id=? AND returned_on IS NULL').get(book.id,d.student_id))fail('This student already has this book.');
    return save('loans',0,{book_id:book.id,student_id:d.student_id,issued_on,due_on},account);
   });
  }else if(kind==='routes'&&['POST','PATCH'].includes(method)){
   const capacity=num(d.capacity,'seats',1,100);if(id&&db.prepare('SELECT COUNT(*) n FROM transport_assignments WHERE route_id=?').get(id).n>capacity)fail('Capacity cannot be below the assigned riders.');
   const stops=text(d.stops,'Stops (one per line)',2000).split('\n').map(s=>s.trim()).filter(Boolean);
   if(id&&db.prepare('SELECT stop FROM transport_assignments WHERE route_id=?').all(id).some(a=>!stops.includes(a.stop)))fail('Reassign riders before removing their boarding stop.');
   result=save('routes',id,{name:text(d.name,'Route name',80),vehicle:text(d.vehicle,'Vehicle number',40),driver:text(d.driver,'Driver name'),phone:text(d.phone,'Driver phone',40),capacity,stops:text(d.stops,'Stops (one per line)',2000),monthly_fee:num(d.monthly_fee,'monthly fee')},account);
  }else if(kind==='transport'&&['POST','PATCH'].includes(method)){
   result=transaction(()=>{activeStudent(d.student_id);const bus=get('routes',d.route_id),stop=text(d.stop,'Stop',160);if(!bus.stops.split('\n').map(s=>s.trim()).includes(stop))fail('Choose a stop on this route.');
    if(db.prepare('SELECT COUNT(*) n FROM transport_assignments WHERE route_id=? AND id<>?').get(bus.id,id).n>=bus.capacity)fail('This route is full.');return save('transport_assignments',id,{student_id:d.student_id,route_id:bus.id,stop},account);
   });
  }else if(kind==='transport'&&method==='DELETE'&&id){get('transport_assignments',id);result=transaction(()=>{db.prepare('DELETE FROM transport_assignments WHERE id=?').run(id);audit(account,'removed',kind,id);return {ok:true};});
  }else if(kind==='notices'&&['POST','PATCH'].includes(method)){
   const published_on=date(d.published_on),expires_on=date(d.expires_on);if(expires_on<published_on)fail('Expiry must be on or after the publication date.');result=save('notices',id,{title:text(d.title,'Title'),body:text(d.body,'Notice',5000),audience:choice(d.audience,['All staff','Teachers','Accounts staff','Administrators','Parents','Students','School community'],'audience'),published_on,expires_on},account);
  }else fail('This operation is not available.',405);
  send(method==='POST'&&!id?201:200,result);return true;
 }
 function seedDemo(){return seedSchoolDemo(db,today,fail);}
 const extensions=createExtensions(db,auth,{fail,text,optional,num,choice,date,today,transaction,get,save,audit,activeStudent,classRecord});
 db.exec('PRAGMA user_version=3;');
 function scopeState(result,account){
  if(!['parent','student'].includes(account.role))return result;
  const ids=auth.studentIds(account),students=result.customers.filter(s=>ids.includes(s.id)),classNames=students.map(s=>s.class_name),fees=result.fees.filter(f=>ids.includes(f.student_id));
  const exams=db.prepare('SELECT * FROM exams ORDER BY exam_date DESC').all().filter(e=>classNames.includes(e.class_name)),published=exams.filter(e=>e.status==='Published').map(e=>e.id);
  return {...result,customers:students,products:[],orders:[],fees,feeTotal:fees.filter(f=>!f.void_reason).reduce((sum,f)=>sum+f.amount,0),classes:result.classes.filter(c=>classNames.includes(c.name)),staff:[],admissions:[],invoices:invoiceRows().filter(i=>ids.includes(i.student_id)),expenses:[],exams,marks:db.prepare('SELECT * FROM marks').all().filter(m=>ids.includes(m.student_id)&&published.includes(m.exam_id)),timetable:db.prepare('SELECT t.*,s.name teacher FROM timetable t JOIN staff s ON s.id=t.teacher_id ORDER BY t.day,t.start_time').all().filter(t=>classNames.includes(t.class_name)),books:[],loans:db.prepare('SELECT l.*,b.title,c.name student,c.class_name FROM loans l JOIN books b ON b.id=l.book_id JOIN customers c ON c.id=l.student_id').all().filter(l=>ids.includes(l.student_id)),routes:[],transport:db.prepare('SELECT a.*,r.name route,r.vehicle,r.driver,r.phone FROM transport_assignments a JOIN routes r ON r.id=a.route_id').all().filter(a=>ids.includes(a.student_id)),attendance:db.prepare('SELECT * FROM attendance ORDER BY date DESC').all().filter(a=>ids.includes(a.student_id)),attendanceSummary:[],attendanceByClass:[],activity:[],payroll:[]};
 }
 return {state,route,seedDemo,invoiceRows,audit,payFee,createStudent,scopeState};
}
