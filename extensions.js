export function createExtensions(db,auth,h){
 const {fail,text,optional,num,choice,date,today,transaction,get,save,audit,activeStudent,classRecord}=h;
 if(!db.prepare('PRAGMA table_info(staff)').all().some(c=>c.name==='base_salary'))db.exec('ALTER TABLE staff ADD COLUMN base_salary INTEGER NOT NULL DEFAULT 0;');
 db.exec(`
 CREATE TABLE IF NOT EXISTS payroll(id INTEGER PRIMARY KEY,staff_id INTEGER NOT NULL REFERENCES staff(id),month TEXT NOT NULL,basic INTEGER NOT NULL CHECK(basic>=0),allowances INTEGER NOT NULL CHECK(allowances>=0),deductions INTEGER NOT NULL CHECK(deductions>=0),status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Paid')),paid_on TEXT,method TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',UNIQUE(staff_id,month),CHECK(basic+allowances>=deductions));
 CREATE TABLE IF NOT EXISTS homework(id INTEGER PRIMARY KEY,class_name TEXT NOT NULL,subject TEXT NOT NULL,title TEXT NOT NULL,instructions TEXT NOT NULL,due_on TEXT NOT NULL,max_marks INTEGER NOT NULL CHECK(max_marks BETWEEN 1 AND 1000),created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE TABLE IF NOT EXISTS submissions(homework_id INTEGER NOT NULL REFERENCES homework(id),student_id INTEGER NOT NULL REFERENCES customers(id),answer TEXT NOT NULL,submitted_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),score INTEGER,feedback TEXT NOT NULL DEFAULT '',PRIMARY KEY(homework_id,student_id));
 CREATE TABLE IF NOT EXISTS leave_requests(id INTEGER PRIMARY KEY,applicant_user INTEGER REFERENCES users(id),applicant_label TEXT NOT NULL DEFAULT '',student_id INTEGER REFERENCES customers(id),from_date TEXT NOT NULL,to_date TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Approved','Declined')),reviewed_by INTEGER REFERENCES users(id),review_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE INDEX IF NOT EXISTS homework_class ON homework(class_name,due_on);
 CREATE INDEX IF NOT EXISTS leave_applicant ON leave_requests(applicant_user,status);
 `);
 const portal=account=>['parent','student'].includes(account.role);
 const linked=account=>auth.studentIds(account);
 function state(account){
  const permissions=auth.permissions(account),isPortal=portal(account),ids=isPortal?linked(account):[],classes=isPortal?db.prepare('SELECT class_name,id FROM customers').all().filter(s=>ids.includes(s.id)).map(s=>s.class_name):[];
  return {
   payroll:permissions.includes('payroll:read')?db.prepare('SELECT p.*,s.name staff,s.department,s.designation,p.basic+p.allowances-p.deductions net FROM payroll p JOIN staff s ON s.id=p.staff_id ORDER BY p.month DESC,s.name').all():[],
   homework:permissions.includes('homework:read')||isPortal?db.prepare('SELECT h.*,u.name teacher FROM homework h LEFT JOIN users u ON u.id=h.created_by ORDER BY h.due_on DESC,h.id DESC').all().filter(h=>!isPortal||classes.includes(h.class_name)):[],
   submissions:permissions.includes('homework:read')||isPortal?db.prepare('SELECT s.*,c.name student,c.class_name FROM submissions s JOIN customers c ON c.id=s.student_id ORDER BY s.submitted_at DESC').all().filter(s=>!isPortal||ids.includes(s.student_id)):[],
   leaveRequests:db.prepare('SELECT l.*,COALESCE(u.name,l.applicant_label) applicant,c.name student,r.name reviewer FROM leave_requests l LEFT JOIN users u ON u.id=l.applicant_user LEFT JOIN customers c ON c.id=l.student_id LEFT JOIN users r ON r.id=l.reviewed_by ORDER BY l.id DESC').all().filter(l=>permissions.includes('leave:review')||l.applicant_user===account.user_id)
  };
 }
 async function route(path,req,res,body,send,account){
  const match=path.match(/^\/api\/(payroll|homework|leave)(?:\/(\d+))?(?:\/(generate|pay|submit|grade|review))?$/);if(!match)return false;
  const [,kind,rawId,action]=match,id=Number(rawId||0),method=req.method;
  if(!['POST','PATCH'].includes(method)||(method==='PATCH'&&!id))fail('Method not allowed.',405);
  const permission=kind==='payroll'?'payroll:write':kind==='leave'?action==='review'?'leave:review':'leave:create':action==='submit'?'homework:submit':'homework:write';
  auth.allow(account,permission);const d=await body(req);account=auth.requireSession(req);auth.csrf(req,account);auth.allow(account,permission);
  let result;
  if(kind==='payroll'){
   const validMonth=value=>{const month=text(value,'Payroll month',7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Choose a valid payroll month.');return month;};
   if(action==='generate'&&method==='POST'){
    const month=validMonth(d.month);result=transaction(()=>{let count=0;for(const staff of db.prepare('SELECT * FROM staff WHERE active=1 AND base_salary>0').all()){if(!db.prepare('SELECT 1 FROM payroll WHERE staff_id=? AND month=?').get(staff.id,month)){save('payroll',0,{staff_id:staff.id,month,basic:staff.base_salary,allowances:0,deductions:0},account);count++;}}return {count};});
   }else if(action==='pay'&&id&&method==='POST'){
    result=transaction(()=>{const row=get('payroll',id);if(row.status==='Paid')fail('This salary has already been paid.',409);const paid_on=date(d.paid_on);if(paid_on>today())fail('Payment date cannot be in the future.');const method=choice(d.method,['Cash','UPI','Bank transfer','Cheque'],'payment method'),reference=text(d.reference,'Payment reference',100),amount=row.basic+row.allowances-row.deductions;if(amount<=0)fail('Net salary must be greater than zero before payment.');save('expenses',0,{category:'Salaries',payee:get('staff',row.staff_id).name,description:'Salary for '+row.month,amount,payment_date:paid_on,method,reference:'PAY-'+id+' · '+reference},account);return save('payroll',id,{status:'Paid',paid_on,method,reference},account);});
   }else if(!action){
    const staff=get('staff',num(d.staff_id,'staff member',1));if(!staff.active)fail('Choose an active staff member.');const month=validMonth(d.month),basic=num(d.basic,'basic salary'),allowances=num(d.allowances,'allowances'),deductions=num(d.deductions,'deductions');if(deductions>basic+allowances)fail('Deductions exceed gross salary.');if(id&&get('payroll',id).status==='Paid')fail('Paid salaries cannot be edited.');result=save('payroll',id,{staff_id:staff.id,month,basic,allowances,deductions},account);
   }else fail('This payroll operation is unavailable.',405);
  }else if(kind==='homework'&&action==='submit'&&id){
   const assignment=get('homework',id),student=activeStudent(num(d.student_id,'student',1));
   if(!linked(account).includes(student.id)||student.class_name!==assignment.class_name)fail('You do not have access to this assignment.',403);
   const answer=text(d.answer,'Homework answer',12000);
   result=transaction(()=>{const old=db.prepare('SELECT score FROM submissions WHERE homework_id=? AND student_id=?').get(id,student.id);if(old?.score!==null&&old?.score!==undefined)fail('This submission is already graded. Ask your teacher before changing it.');db.prepare("INSERT INTO submissions(homework_id,student_id,answer) VALUES(?,?,?) ON CONFLICT(homework_id,student_id) DO UPDATE SET answer=excluded.answer,submitted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(id,student.id,answer);audit(account,'submitted','homework',id);return {ok:true};});
  }else if(kind==='homework'&&action==='grade'&&id){
   const assignment=get('homework',id);num(d.student_id,'student',1);if(!db.prepare('SELECT 1 FROM submissions WHERE homework_id=? AND student_id=?').get(id,d.student_id))fail('This student has not submitted homework.');
   result=transaction(()=>{db.prepare('UPDATE submissions SET score=?,feedback=? WHERE homework_id=? AND student_id=?').run(num(d.score,'score',0,assignment.max_marks),optional(d.feedback,'Feedback',2000),id,d.student_id);audit(account,'graded','homework',id);return {ok:true};});
  }else if(kind==='homework'&&!action){
   const class_name=classRecord(d.class_name),max_marks=num(d.max_marks,'maximum marks',1,1000);if(id){const old=get('homework',id);if(old.class_name!==class_name&&db.prepare('SELECT 1 FROM submissions WHERE homework_id=?').get(id))fail('Class cannot change after a submission.');if(db.prepare('SELECT 1 FROM submissions WHERE homework_id=? AND score>?').get(id,max_marks))fail('Maximum marks cannot be below an existing grade.');}
   result=save('homework',id,{class_name,subject:text(d.subject,'Subject',80),title:text(d.title,'Assignment title'),instructions:text(d.instructions,'Instructions',12000),due_on:date(d.due_on),max_marks,...(!id?{created_by:account.user_id}:{})},account);
  }else if(kind==='leave'&&action==='review'&&id){
   const request=get('leave_requests',id);if(request.applicant_user===account.user_id)fail('Another administrator must review your own leave request.');if(request.status!=='Pending')fail('This request has already been reviewed.',409);result=save('leave_requests',id,{status:choice(d.status,['Approved','Declined'],'review outcome'),review_note:optional(d.review_note,'Review note',2000),reviewed_by:account.user_id},account);
  }else if(kind==='leave'&&!id&&!action){
   const from_date=date(d.from_date),to_date=date(d.to_date),student_id=d.student_id?num(d.student_id,'student',1):null;
   if(to_date<from_date||(Date.parse(to_date)-Date.parse(from_date))/86400000>90)fail('Choose a leave period of up to 91 days.');
   if(portal(account)&&(!student_id||!linked(account).includes(student_id)))fail('Choose a student linked to your account.',403);
   if(student_id){activeStudent(student_id);if(!portal(account)&&account.role!=='admin')fail('Staff may request leave only for themselves.',403);}
   if(db.prepare("SELECT 1 FROM leave_requests WHERE status IN('Pending','Approved') AND from_date<=? AND to_date>=? AND ((? IS NOT NULL AND student_id=?) OR (? IS NULL AND student_id IS NULL AND applicant_user=?))").get(to_date,from_date,student_id,student_id,student_id,account.user_id))fail('There is already a pending or approved leave request for these dates.');
   result=save('leave_requests',0,{applicant_user:account.user_id,student_id,from_date,to_date,reason:text(d.reason,'Leave reason',2000)},account);
  }else fail('This operation is unavailable.',405);
  send(id?200:201,result);return true;
 }
 return {state,route};
}
