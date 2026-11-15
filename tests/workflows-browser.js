import assert from 'node:assert/strict';
import {startBrowser} from './browser-harness.js';
const browser=await startBrowser();
try{
 const {evaluate,rpc,screenshot}=browser;
 await evaluate(`(async()=>{
  window.uiWait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+predicate+'; '+document.querySelector('dialog .error')?.textContent);};
  window.uiSet=(name,value)=>{const el=document.querySelector('dialog[open] [name="'+name+'"]')||document.querySelector('#app form [name="'+name+'"]');if(!el)throw Error('Missing field '+name);el.value=value;el.dispatchEvent(new Event('change'));};
  window.uiSubmit=()=>(document.querySelector('dialog[open] form')||document.querySelector('#app form')).requestSubmit();
  window.uiClick=selector=>{const el=document.querySelector(selector);if(!el)throw Error('Missing control '+selector);el.click();};
  window.uiSave=async()=>{uiSubmit();await uiWait(()=>!document.querySelector('dialog').open);};
  window.uiSignIn=async(email,password)=>{uiSet('email',email);uiSet('password',password);uiSubmit();await uiWait(()=>document.querySelector('.shell'));};
  uiSet('name','Demo Administrator');uiSet('email','workflow-admin@school.test');uiSet('password','workflow admin password 123');uiSet('confirmPassword','workflow admin password 123');uiSubmit();await uiWait(()=>document.querySelector('.shell'));
  if(state.customers.length!==72)throw Error('Demo school was not loaded.');
 })()`);
 await screenshot('tests/workspace-desktop.png');
 await evaluate(`(async()=>{
  goTo('attendance');await uiWait(()=>!attendanceLoading);
  const select=document.querySelector('[data-attendance]'),studentId=Number(select.dataset.attendance);
  select.value='Present';select.dispatchEvent(new Event('change'));
  const realFetch=window.fetch;let release,waiting=false;
  const gate=new Promise(resolve=>release=resolve);
  window.fetch=async(url,options)=>{if(url==='/api/attendance'&&options?.method==='POST'){waiting=true;await gate;}return realFetch(url,options);};
  try{
   const saving=saveAttendance();await uiWait(()=>waiting);
   select.value='Absent';select.dispatchEvent(new Event('change'));release();await saving;
   if(!attendanceDirty||!attendanceChanges.has(studentId))throw Error('Attendance edits during save were lost');
  }finally{release();window.fetch=realFetch;}
  const realConfirm=window.confirm;window.confirm=()=>false;
  try{const search=document.querySelector('#global-search');search.value='Student';search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));if(view!=='attendance')throw Error('Search discarded unsaved attendance');}finally{window.confirm=realConfirm;}
  await saveAttendance();if(attendanceDirty)throw Error('Attendance changes were not cleared after saving');
  const saved=await api('attendance?date='+attendanceDate);if(saved.records.find(r=>r.student_id===studentId)?.status!=='Absent')throw Error('Latest attendance was not saved');
  goTo('dashboard');
 })()`);
 const result=await evaluate(`(async()=>{
  const visited=[];
  for(const [key]of Object.entries(workspaceViews)){if(!canView(key))continue;goTo(key);await uiWait(()=>document.querySelector('#content'));if(key==='users')await uiWait(()=>document.querySelector('#user-list table'));if(key==='attendance')await uiWait(()=>!attendanceLoading);if(document.querySelector('#content').textContent.includes('undefined'))throw Error('Undefined content in '+key);visited.push(key);}
  goTo('admissions');uiClick('[data-add="admissions"]');uiSet('name','Demo Workflow Student');uiSet('guardian','Demo Workflow Parent');uiSet('phone','9000012345');uiSet('class_name','8 A');uiSet('status','Accepted');await uiSave();
  const application=state.admissions.find(a=>a.name==='Demo Workflow Student');uiClick('[data-action="enroll"][data-id="'+application.id+'"]');uiSet('admission_no','WORKFLOW-001');await uiSave();
  const student=state.customers.find(s=>s.admission_no==='WORKFLOW-001');if(!student)throw Error('Enrolment did not create student.');window.testStudent=student;
  goTo('billing');uiClick('[data-add="billing"]');uiSet('student_id',student.id);uiSet('purpose','Workflow tuition');uiSet('amount','1000');await uiSave();
  const invoice=state.invoices.find(i=>i.student_id===student.id);schoolFeeForm(invoice.id);uiSet('amount','400');await uiSave();if(state.invoices.find(i=>i.id===invoice.id).balance!==60000)throw Error('Partial payment did not update balance.');
  schoolFeeForm(invoice.id);uiSet('student_id',1);const paymentForm=document.querySelector('dialog form');if(paymentForm.elements.amount.max!=='1000000')throw Error('Switching students retained the previous invoice payment limit');uiClick('dialog #cancel');
  goTo('library');openSchoolForm('loans',0,{student_id:student.id});await uiSave();const loan=state.loans.find(l=>l.student_id===student.id);uiClick('[data-action="return"][data-id="'+loan.id+'"]');await uiSave();if(!state.loans.find(l=>l.id===loan.id).returned_on)throw Error('Book return failed.');
  goTo('transport');openSchoolForm('transport',0,{student_id:student.id});await uiSave();if(!state.transport.some(a=>a.student_id===student.id))throw Error('Transport assignment failed.');
  goTo('exams');openSchoolForm('exams',0,{name:'Workflow assessment',class_name:'8 A',subject:'Mathematics',max_marks:50});await uiSave();
  const exam=state.exams.find(e=>e.name==='Workflow assessment');marksForm(exam.id);document.querySelectorAll('[name^="mark-"]').forEach(el=>el.value='42');await uiSave();openSchoolForm('exams',exam.id);uiSet('status','Published');await uiSave();if(state.exams.find(e=>e.id===exam.id).status!=='Published')throw Error('Publishing results failed.');
  goTo('timetable');openSchoolForm('timetable',0,{class_name:'8 A',day:'Saturday',start_time:'13:00',end_time:'13:45',subject:'Art',teacher_id:1,room:'ART-NEW'});await uiSave();
  goTo('payroll');const salary=state.payroll.find(p=>p.status==='Draft');uiClick('[data-action="pay-salary"][data-id="'+salary.id+'"]');uiSet('reference','WORKFLOW-SALARY');await uiSave();if(state.payroll.find(p=>p.id===salary.id).status!=='Paid')throw Error('Salary payment failed.');
  goTo('users');await uiWait(()=>document.querySelector('#user-list table'));
  window.createPortalAccount=async(role,email,ids)=>{uiClick('[data-add="users"]');uiSet('name','Workflow '+role);uiSet('email',email);uiSet('role',role);const select=document.querySelector('[name="student_ids"]');for(const option of select.options)option.selected=ids.includes(Number(option.value));uiSubmit();await uiWait(()=>document.querySelector('#reset-link'));const link=document.querySelector('#reset-link').value;uiClick('#close-link');return link;};
  window.studentLink=await createPortalAccount('student','workflow-student@school.test',[student.id]);window.parentLink=await createPortalAccount('parent','workflow-parent@school.test',[student.id,1]);
  window.activatePortal=async(link,email,password)=>{location.hash=new URL(link).hash;await uiWait(()=>document.querySelector('#back-login')&&!document.querySelector('#app form').hidden);uiSet('password',password);uiSet('confirmPassword',password);uiSubmit();await uiWait(()=>document.querySelector('#login'));await uiSignIn(email,password);};
  await activatePortal(studentLink,'workflow-student@school.test','workflow student password 123');
  if(state.customers.length!==1||state.customers[0].id!==student.id||!document.querySelector('.portal-shell'))throw Error('Student portal isolation failed.');
  goTo('portal-homework');const assignment=state.homework.find(h=>h.subject==='English');uiClick('[data-submit-homework="'+assignment.id+'"]');uiSet('answer','I want to learn to write clear stories this year. I will read every day and practise writing.');await uiSave();
  goTo('portal-leave');uiClick('#portal-request-leave');uiSet('from_date','2027-04-01');uiSet('to_date','2027-04-02');uiSet('reason','Family event');await uiSave();
  return {visited:visited.length,student:student.name,studentId:student.id,homeworkId:assignment.id};
 })()`);
 console.log(JSON.stringify(result));
 await rpc('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate("goTo('portal-home')");
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Student portal overflows on mobile');
 await screenshot('tests/student-portal-mobile.png');
 await evaluate(`(async()=>{
  await activatePortal(parentLink,'workflow-parent@school.test','workflow parent password 123');
  if(state.customers.length!==2||!document.querySelector('#portal-student'))throw Error('Parent sibling selector is missing.');
  for(const option of document.querySelector('#portal-student').options){document.querySelector('#portal-student').value=option.value;document.querySelector('#portal-student').dispatchEvent(new Event('change'));if(!document.body.textContent.includes(state.customers.find(s=>s.id===Number(option.value)).name))throw Error('Parent student switch failed.');}
  for(const [key]of portalViews){goTo(key);if(!document.querySelector('#content'))throw Error('Portal view missing '+key);}
  uiClick('#logout');await uiWait(()=>document.querySelector('#login'));await uiSignIn('workflow-admin@school.test','workflow admin password 123');
  if(state.customers.length!==73)throw Error('Administrator did not regain school scope.');
  goTo('homework');const assignment=state.homework.find(h=>h.class_name==='8 A'&&h.subject==='English');gradeSubmission(assignment.id,testStudent.id);uiSet('score','23');uiSet('feedback','Clear writing. Keep practising.');await uiSave();
  goTo('leave');const request=state.leaveRequests.find(l=>l.student_id===testStudent.id);uiClick('[data-action="review-leave"][data-id="'+request.id+'"]');uiSet('review_note','Approved for family event.');await uiSave();
  goTo('settings');document.querySelector('[name="school_phone"]').value='+91 120 555 0101';document.querySelector('#settings-form').requestSubmit();await uiWait(()=>state.settings.school_phone==='+91 120 555 0101');
  goTo('dashboard');
 })()`);
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Staff dashboard overflows on mobile');
 await screenshot('tests/workspace-mobile.png');
 await rpc('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await screenshot('tests/workspace-desktop.png');
 assert.deepEqual(browser.errors,[],'Browser console errors: '+JSON.stringify(browser.errors));
 console.log('All module screens, admissions, partial fees, lending, transport, marks, payroll, student/parent portals, homework, leave, and mobile layouts passed.');
}finally{await browser.close();}
