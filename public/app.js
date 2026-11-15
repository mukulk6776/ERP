const app=document.querySelector('#app');let state={products:[],customers:[],orders:[],fees:[],feeTotal:0},view='dashboard',query='';
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n/100);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let authLoadVersion=0;
function clearAccount(){
 authLoadVersion++;authSession=null;attendanceDirty=false;view='dashboard';query='';
 state={products:[],customers:[],orders:[],fees:[],feeTotal:0};
 document.querySelector('#modal')?.close();
}
async function api(path,method='GET',data){
 const version=authLoadVersion;
 const response=await fetch('/api/'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json',...(authSession?.csrfToken?{'X-CSRF-Token':authSession.csrfToken}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json();
 if(version!==authLoadVersion)throw Object.assign(new Error('Your account changed. Please try again.'),{stale:true});
 if(!response.ok){
  if(response.status===401&&!['login','setup','reset-password'].includes(path)){
   login(false);authError(document.querySelector('#login'),result.error);
  }
  throw Object.assign(new Error(result.error),{status:response.status});
 }
 return result;
}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.style.display='none',3500);}
async function init(){
 if(passwordLinkScreen())return;
 const version=++authLoadVersion;
 try{const session=await api('session');if(version!==authLoadVersion)return;authSession=session;if(!session.authenticated)return login(session.setupRequired,session.migrationRequired);if(!canView(view))view='dashboard';const records=await api('state');if(version!==authLoadVersion)return;state=records;render();}
 catch(e){if(e.stale||version!==authLoadVersion)return;clearAccount();app.innerHTML='<div class="login panel"><h1>Unable to connect</h1><p>'+esc(e.message)+'</p><button id="retry">Try again</button></div>';document.querySelector('#retry').onclick=init;}
}
function table(headers,rows,empty='No records yet. Add your first record to get started.'){return '<div class="tablewrap"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>'+(!rows.length?'<div class="empty">'+empty+'</div>':'');}
function render(){renderWorkspace();}
function field(label,name,type='text',attrs=''){return '<label>'+label+'<input name="'+name+'" type="'+type+'" '+attrs+'></label>';}
function openForm(kind){if(canAdd(kind)&&['customers','classes','staff','admissions','billing','expenses','exams','timetable','library','transport','notices','payroll','homework','leave'].includes(kind))return openSchoolForm(({billing:'invoices',library:'books',transport:'routes'})[kind]||kind);if(!canAdd(kind))return toast('Your account does not have permission for this action.');if(kind==='users')return createUserForm();if(kind==='attendance')return saveAttendance();if(kind==='fees')return openFeeForm();const modal=document.querySelector('#modal');let fields='';
 if(kind==='inventory')fields=field('Item name (for example, Class 5 Maths book)','name','text','required maxlength="160"')+field('Item code (a unique short code)','sku','text','required maxlength="50"')+field('Price per item (₹)','price','number','required min="0" max="1000000" step="0.01"')+field('Number of items available','stock','number','required min="0" max="100000000" step="1" value="0"');
 if(kind==='orders'){if(!state.customers.length||!state.products.length){toast('Add a student and a supply item first. Use Students and School supplies in the menu.');return;}fields='<label>Student<select name="customer_id">'+activeStudents().map(c=>'<option value="'+c.id+'">'+esc(c.name)+(c.class_name?' · '+esc(c.class_name):'')+'</option>').join('')+'</select></label><div id="lines"></div><button type="button" class="secondary" id="addline">+ Add another item</button><strong id="order-total"></strong>';}
 modal.innerHTML='<form><h2>'+{inventory:'Add a school supply item',customers:'Add a student',orders:'Give items to a student'}[kind]+'</h2>'+fields+'<div class="error" role="alert"></div><div class="formactions"><button type="button" class="secondary" id="cancel">Cancel</button><button id="save">Save '+(kind==='orders'?'issue record':'record')+'</button></div></form>';document.querySelector('#cancel').onclick=()=>modal.close();
 if(kind==='orders'){const addLine=()=>{const row=document.createElement('div');row.className='line';row.innerHTML='<select aria-label="Item">'+state.products.filter(p=>p.active!==0).map(p=>'<option value="'+p.id+'">'+esc(p.name)+' · '+money(p.price)+' · '+p.stock+' left</option>').join('')+'</select><input type="number" aria-label="Quantity" min="1" max="100000" step="1" value="1" required><button type="button" class="secondary" aria-label="Remove item">×</button>';row.querySelector('button').onclick=()=>{row.remove();updateTotal();};row.oninput=updateTotal;document.querySelector('#lines').append(row);updateTotal();};document.querySelector('#addline').onclick=addLine;addLine();}
 modal.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('#save');b.disabled=true;const d=Object.fromEntries(new FormData(e.target));try{if(kind==='inventory'){d.price=Math.round(Number(d.price)*100);d.stock=Number(d.stock);}if(kind==='orders'){d.customer_id=Number(d.customer_id);d.lines=[...document.querySelectorAll('#lines .line')].map(row=>({product_id:Number(row.querySelector('select').value),quantity:Number(row.querySelector('input').value)}));}await api({inventory:'products',customers:'customers',orders:'orders'}[kind],'POST',d);state=await api('state');modal.close();render();toast('Saved successfully');}catch(err){e.target.querySelector('.error').textContent=err.message;b.disabled=false;}};
 modal.showModal();
}
function updateTotal(){const total=[...document.querySelectorAll('#lines .line')].reduce((sum,row)=>sum+(state.products.find(p=>p.id===Number(row.querySelector('select').value))?.price||0)*Number(row.querySelector('input').value),0);document.querySelector('#order-total').textContent='Total value of items: '+money(total);}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let attendanceChanges=new Set();
let attendanceDate=today(),attendanceRecords={},attendanceLoading=false,attendanceDirty=false,attendanceVersion=0;
function studentOptions(){return activeStudents().map(c=>'<option value="'+c.id+'">'+esc(c.name)+' · '+esc(c.class_name||'Class not added')+' · '+esc(c.admission_no||'No admission number')+'</option>').join('');}
function openFeeForm(){schoolFeeForm();}
function attendancePage(){
 const content=document.querySelector('#content');content.innerHTML='<div class="panel"><div class="panelhead"><label>Attendance date<input id="attendance-date" type="date" value="'+attendanceDate+'" required></label><label>Find a student or class<input id="attendance-search" placeholder="Name, admission number, or class"></label></div><p id="attendance-help" role="status">Loading attendance…</p><div class="attendance-bulk"><label>Class<select id="attendance-class"><option value="">All classes</option>'+(state.classes||[]).map(c=>'<option>'+esc(c.name)+'</option>').join('')+'</select></label><button class="secondary" id="mark-present">Mark shown students present</button><button class="secondary" id="mark-absent">Mark shown students absent</button></div><div id="attendance-list"></div></div>';
 document.querySelector('#attendance-date').onchange=async e=>{if(!e.target.value){e.target.value=attendanceDate;return;}if(attendanceDirty&&!confirm('You have unsaved attendance. Change the date and discard those changes?')){e.target.value=attendanceDate;return;}attendanceDate=e.target.value;await loadAttendance();};
 document.querySelector('#attendance-search').oninput=attendanceTable;document.querySelector('#attendance-class').onchange=attendanceTable;for(const [id,status]of [['mark-present','Present'],['mark-absent','Absent']])document.querySelector('#'+id).onclick=()=>{if(attendanceLoading)return;document.querySelectorAll('[data-attendance]').forEach(el=>{attendanceRecords[el.dataset.attendance]=status;attendanceChanges.add(Number(el.dataset.attendance));});attendanceDirty=true;attendanceTable();};loadAttendance();
}
async function loadAttendance(){
 attendanceLoading=true;attendanceDirty=false;attendanceRecords={};attendanceChanges.clear();const version=++attendanceVersion;
 try{const result=await api('attendance?date='+attendanceDate);if(version!==attendanceVersion||view!=='attendance')return;attendanceRecords=Object.fromEntries(result.records.map(r=>[r.student_id,r.status]));attendanceLoading=false;attendanceTable();}
 catch(e){if(version!==attendanceVersion||view!=='attendance')return;document.querySelector('#attendance-help').textContent='Could not load attendance. '+e.message;attendanceLoading=true;}
}
function attendanceTable(){
 if(attendanceLoading)return;const target=document.querySelector('#attendance-list');if(!target)return;
 const query=document.querySelector('#attendance-search').value.toLowerCase();
 const selectedClass=document.querySelector('#attendance-class').value;const students=activeStudents().filter(c=>(!selectedClass||c.class_name===selectedClass)&&[c.name,c.admission_no,c.class_name].some(v=>String(v||'').toLowerCase().includes(query)));
 document.querySelector('#attendance-help').textContent='Choose Present, Absent, or On leave for each student, then click Save attendance. Unmarked students stay unmarked.';
 target.innerHTML=table(['Student','Admission number','Class / section','Attendance'],students.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.admission_no||'—')+'</td><td>'+esc(c.class_name||'—')+'</td><td><select data-attendance="'+c.id+'" aria-label="Attendance for '+esc(c.name)+'"><option value="">Not marked</option>'+['Present','Absent','On leave'].map(s=>'<option '+(attendanceRecords[c.id]===s?'selected':'')+'>'+s+'</option>').join('')+'</select></td></tr>'),'No students found. Add students from the Students page.');
 target.querySelectorAll('[data-attendance]').forEach(el=>{if(attendanceRecords[el.dataset.attendance])el.querySelector('option[value=""]').disabled=true;el.onchange=()=>{if(el.value)attendanceRecords[el.dataset.attendance]=el.value;else delete attendanceRecords[el.dataset.attendance];attendanceDirty=true;attendanceChanges.add(Number(el.dataset.attendance));};});
}
async function saveAttendance(){
 if(attendanceLoading)return toast('Wait for attendance to load. If loading failed, reopen Attendance to retry.');
 if(!attendanceChanges.size)return toast('No unsaved attendance changes.');const records=Object.entries(attendanceRecords).filter(([id])=>attendanceChanges.has(Number(id))&&activeStudents().some(s=>s.id===Number(id))).map(([id,status])=>({student_id:Number(id),status}));if(!records.length)return toast('Choose attendance for at least one student before saving.');
 const button=document.querySelector('[data-add="attendance"]');button.disabled=true;
 const savedDate=attendanceDate,version=attendanceVersion;
 try{await api('attendance','POST',{date:savedDate,records});if(version===attendanceVersion&&savedDate===attendanceDate){for(const row of records){if(attendanceRecords[row.student_id]===row.status)attendanceChanges.delete(row.student_id);}attendanceDirty=attendanceChanges.size>0;}state=await api('state');toast('Attendance saved for '+savedDate+'.'+(attendanceDirty?' New changes still need saving.':''));}catch(e){toast(e.message);}finally{if(button.isConnected)button.disabled=false;}
}
function receipt(id){
 const fee=state.fees.find(f=>f.id===id);if(!fee)return;const modal=document.querySelector('#modal');
 modal.innerHTML='<article class="receipt"><div class="eyebrow">PAYMENT RECEIPT</div><h2>'+esc(schoolLabel())+'</h2><p>Receipt FEE-'+String(fee.id).padStart(4,'0')+'</p><hr><p>Student: <strong>'+esc(fee.student)+'</strong></p><p>Admission number: '+esc(fee.admission_no||'—')+' · Class: '+esc(fee.class_name||'—')+'</p><p>Payment for: '+esc(fee.purpose)+'</p><p>Date: '+esc(fee.payment_date)+' · Method: '+esc(fee.method)+'</p><h2>Amount received: '+money(fee.amount)+'</h2><p>'+(fee.void_reason?'VOIDED: '+esc(fee.void_reason):'This receipt records a payment received by the school.')+'</p></article><div class="formactions"><button class="secondary" id="close-receipt">Close</button><button id="print-receipt">Print receipt</button></div>';
 modal.querySelector('#close-receipt').onclick=()=>modal.close();modal.querySelector('#print-receipt').onclick=()=>window.print();modal.showModal();
}
document.addEventListener('click',e=>{const button=e.target.closest('[data-receipt]');if(button)receipt(Number(button.dataset.receipt));});
window.addEventListener('beforeunload',e=>{if(attendanceDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).has('reset'))init();});

init();
