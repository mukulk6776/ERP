let authSession=null;
const roleNames={admin:'Administrator',teacher:'Teacher',accountant:'Accounts staff',parent:'Parent',student:'Student'};
function has(permission){return !!authSession?.permissions?.includes(permission);}
function canView(key){if(authSession?.user&&['parent','student'].includes(authSession.user.role))return key==='dashboard'||['portal-home','portal-attendance','portal-fees','portal-results','portal-homework','portal-timetable','portal-library','portal-transport','portal-leave','portal-notices'].includes(key);if(['reports','notices'].includes(key))return true;if(moduleAccess[key])return has(moduleAccess[key]);return key==='dashboard'||key==='account'||({customers:'students:read',attendance:'attendance:read',fees:'fees:read',inventory:'supplies:read',orders:'supplies:read',users:'users:manage'}[key]&&has({customers:'students:read',attendance:'attendance:read',fees:'fees:read',inventory:'supplies:read',orders:'supplies:read',users:'users:manage'}[key]));}
function canAdd(key){if(moduleWrites[key])return has(moduleWrites[key]);return has({dashboard:'students:write',customers:'students:write',attendance:'attendance:write',fees:'fees:write',inventory:'supplies:write',orders:'supplies:write',users:'users:manage'}[key]);}
function authFields(showConfirm=true){return '<label>New password<input name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required><span class="muted">Use at least 15 characters. A long phrase is easier to remember.</span></label>'+(showConfirm?'<label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label>':'');}
function login(setup,migration=false,address=''){
 clearAccount();
 app.innerHTML='<div class="login panel"><div class="brand">Shambhu Dayal<br>Global School</div><div class="eyebrow">SCHOOL SIGN IN</div><h1>'+(setup?'Create the administrator account':'Welcome back')+'</h1><p>'+(migration?'Verify the current school password, then create your personal administrator account. Existing school records will stay in place.':setup?'Create the first administrator account. Only an administrator can add other school accounts.':'Use the email and password for your school account.')+'</p><form id="login">'+(setup?field('Your full name','name','text','required maxlength="160" autocomplete="name"'):'')+field('Email address','email','email','required maxlength="254" autocomplete="username"')+(migration?field('Current shared school password','currentPassword','password','required maxlength="256" autocomplete="current-password"'):'')+(setup?authFields():field('Password','password','password','required maxlength="128" autocomplete="current-password"'))+'<label class="checkbox"><input type="checkbox" data-show-password> Show password</label><div class="error" role="alert"></div><button type="submit">'+(setup?'Create administrator account':'Sign in')+'</button></form><p class="muted">Need an account or forgot your password? Ask your school administrator for a password setup link.</p></div>';
 mountAuthPanel(setup?'setup':'signin');
 const form=document.querySelector('#login');showPassword(form);
 form.elements.email.value=address;
 form.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));if(setup&&d.password!==d.confirmPassword)return authError(form,'The new passwords do not match.');authBusy(form);try{authSession=await api(setup?'setup':'login','POST',d);view='dashboard';query='';await init();}catch(err){authError(form,err.message);}};
}
function passwordLinkScreen(){
 const params=new URLSearchParams(location.hash.slice(1));if(!params.has('reset'))return false;
 const tokenValue=params.get('reset');clearAccount();
 // Remove the secret from the address bar and browser history after reading it.
 history.replaceState(null,'',location.pathname);
 app.innerHTML='<div class="login panel"><div class="brand">Shambhu Dayal<br>Global School</div><h1>Set your account password</h1><p>This link works once and expires after 30 minutes. Choose a password only you know.</p><form>'+authFields()+'<label class="checkbox"><input type="checkbox" data-show-password> Show password</label><div class="error" role="alert"></div><button type="submit">Save password</button><button type="button" class="secondary" id="back-login">Back to sign in</button></form></div>';
 mountAuthPanel('reset');
 const form=app.querySelector('form');showPassword(form);document.querySelector('#back-login').onclick=init;
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Checking your password link…';form.before(status);form.hidden=true;
 let address='';
 const check=async()=>{
  try{
   const details=await api('validate-reset','POST',{token:tokenValue});if(!form.isConnected)return;
   address=details.email;status.textContent='Set a password for '+details.name+' ('+details.email+').';form.hidden=false;
  }catch(err){
   if(!form.isConnected||err.stale)return;
   status.textContent=err.message;form.hidden=false;
   form.innerHTML='<button type="button" class="secondary" id="back-login">Back to sign in</button>';
   form.querySelector('#back-login').onclick=init;
   if(!err.status){const retry=document.createElement('button');retry.type='button';retry.textContent='Try again';retry.onclick=()=>{history.replaceState(null,'',location.pathname+'#reset='+encodeURIComponent(tokenValue));init();};form.prepend(retry);}
  }
 };
 check();
 form.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));if(d.password!==d.confirmPassword)return authError(form,'The new passwords do not match.');authBusy(form);try{await api('reset-password','POST',{token:tokenValue,password:d.password});login(false,false,address);toast('Password saved. Sign in with your staff email and new password.');}catch(err){if(form.isConnected)authError(form,err.message);}};return true;
}
function accountDialog(){
 const modal=document.querySelector('#modal');modal.innerHTML='<form><h2>My account</h2><p><strong>'+esc(authSession.user.name)+'</strong><br>'+esc(authSession.user.email)+' · '+roleNames[authSession.user.role]+'</p>'+field('Current password','currentPassword','password','required maxlength="128" autocomplete="current-password"')+authFields()+'<div class="error" role="alert"></div><div class="formactions"><button type="button" class="secondary" id="account-close">Cancel</button><button type="submit">Change password</button></div><button type="button" class="secondary" id="logout-all">Sign out on all devices</button></form>';
 modal.querySelector('#account-close').onclick=()=>modal.close();
 modal.querySelector('#logout-all').onclick=async()=>{try{await api('logout-all','POST',{});modal.close();attendanceDirty=false;view='dashboard';await init();toast('Signed out on all devices.');}catch(e){modal.querySelector('.error').textContent=e.message;}};
 const form=modal.querySelector('form');showPassword(form);form.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form));if(d.password!==d.confirmPassword)return authError(form,'The new passwords do not match.');authBusy(form);try{authSession=await api('change-password','POST',d);modal.close();toast('Password changed. Other sessions have been signed out.');}catch(err){authError(form,err.message);}};
 modal.showModal();
}
function roleOptions(role='teacher'){return Object.entries(roleNames).map(([key,label])=>'<option value="'+key+'" '+(role===key?'selected':'')+'>'+label+'</option>').join('');}
function accountStudentFields(selected=[]){return '<label id="account-students" hidden>Linked students<select name="student_ids" multiple size="6">'+activeStudents().map(s=>'<option value="'+s.id+'" '+(selected.includes(s.id)?'selected':'')+'>'+esc(s.name)+' · '+esc(s.class_name)+' · '+esc(s.admission_no)+'</option>').join('')+'</select><span class="muted">Select one student for a student account. Parent accounts can link siblings; use Ctrl to select more than one.</span></label>';}
function bindAccountRole(form){const update=()=>{const enabled=['parent','student'].includes(form.elements.role.value),select=form.elements.student_ids;form.querySelector('#account-students').hidden=!enabled;select.disabled=!enabled;select.required=enabled;};form.elements.role.addEventListener('change',update);update();}
function accountPayload(form){const data=new FormData(form);return {...Object.fromEntries(data),student_ids:data.getAll('student_ids').map(Number)};}
function createUserForm(){
 const modal=document.querySelector('#modal');modal.innerHTML='<form><h2>Add a school account</h2>'+field('Full name','name','text','required maxlength="160"')+field('Email address','email','email','required maxlength="254"')+'<label>Role<select name="role">'+roleOptions()+'</select></label>'+accountStudentFields()+'<p>A private password setup link will appear after you save. Share it directly with this staff member; it expires in 30 minutes.</p><div class="error" role="alert"></div><div class="formactions"><button type="button" class="secondary" id="cancel-user">Cancel</button><button type="submit">Create account</button></div></form>';
 const form=modal.querySelector('form');bindAccountRole(form);modal.querySelector('#cancel-user').onclick=()=>modal.close();form.onsubmit=async e=>{e.preventDefault();authBusy(form);try{const result=await api('users','POST',accountPayload(form));modal.close();await usersPage();showResetLink(result.resetToken);}catch(err){authError(form,err.message);}};modal.showModal();
}
function showResetLink(value){
 const modal=document.querySelector('#modal');const link=location.origin+'/#reset='+value;
 modal.innerHTML='<h2>Password setup link</h2><p>Share this private link directly with the staff member. It works once and expires in 30 minutes. Do not post it in a shared group.</p><label>Private link<input id="reset-link" readonly value="'+esc(link)+'"></label><p class="muted">If the link expires, create another from Staff accounts. No email has been sent.</p><div class="formactions"><button class="secondary" id="close-link">Done</button><button id="copy-link">Copy link</button></div>';
 modal.querySelector('#close-link').onclick=()=>modal.close();modal.querySelector('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('Private link copied.');}catch{const input=modal.querySelector('input');input.select();toast('Select and copy the link above.');}};modal.showModal();
}
function editUser(user){
 const modal=document.querySelector('#modal');modal.innerHTML='<form><h2>Edit staff access</h2><p>'+esc(user.name)+' · '+esc(user.email)+'</p><label>Role<select name="role">'+roleOptions(user.role)+'</select></label>'+accountStudentFields(user.student_ids||[])+'<label>Account status<select name="active"><option value="true" '+(user.active?'selected':'')+'>Active</option><option value="false" '+(!user.active?'selected':'')+'>Disabled</option></select></label><p>Saving access changes signs this person out on all devices.</p><div class="error" role="alert"></div><div class="formactions"><button type="button" class="secondary" id="cancel-access">Cancel</button><button type="submit">Save access</button></div></form>';
 const form=modal.querySelector('form');bindAccountRole(form);modal.querySelector('#cancel-access').onclick=()=>modal.close();form.onsubmit=async e=>{e.preventDefault();authBusy(form);const d=accountPayload(form);d.active=d.active==='true';try{await api('users/'+user.id,'PATCH',d);modal.close();await usersPage();toast('Staff access updated.');}catch(err){authError(form,err.message);}};modal.showModal();
}



function authBusy(form){
 const button=form.querySelector('[type="submit"]');
 if(!button)return;button.dataset.idleText ||= button.textContent;
 button.disabled=true;button.textContent='Please wait…';form.querySelector('.error').textContent='';form.setAttribute('aria-busy','true');
}
function authError(form,message){
 const error=form.querySelector('.error');
 error.textContent=message;error.tabIndex=-1;error.focus({preventScroll:false});
 const button=form.querySelector('[type="submit"]');
 if(button){button.disabled=false;button.textContent=button.dataset.idleText||button.textContent;}
 form.removeAttribute('aria-busy');
}
function showPassword(form){
 form.querySelector('label.checkbox')?.remove();
 for(const input of form.querySelectorAll('input[type="password"]')){
  const container=document.createElement('div');container.className='password-field';
  input.before(container);container.append(input);
  input.id ||= 'password-'+Math.random().toString(36).slice(2);
  const button=document.createElement('button');button.type='button';button.className='password-toggle';
  button.textContent='Show';button.setAttribute('aria-label','Show '+(input.name==='confirmPassword'?'confirmed password':input.name==='currentPassword'?'current password':'password'));
  button.setAttribute('aria-controls',input.id);button.setAttribute('aria-pressed','false');
  button.onclick=()=>{const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'Hide':'Show';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',(visible?'Hide ':'Show ')+(input.name==='currentPassword'?'current password':input.name==='confirmPassword'?'confirmed password':'password'));};
  container.append(button);
 }
 const password=form.querySelector('[name="password"]'),confirmation=form.querySelector('[name="confirmPassword"]');
 if(confirmation&&password){
  const feedback=document.createElement('span');feedback.className='password-feedback';feedback.setAttribute('aria-live','polite');
  confirmation.closest('label').append(feedback);
  const update=()=>{const matches=password.value===confirmation.value;confirmation.setCustomValidity(confirmation.value&&!matches?'The new passwords do not match.':'');confirmation.setAttribute('aria-invalid',String(!!confirmation.value&&!matches));feedback.textContent=confirmation.value?(matches?'Passwords match':'Passwords do not match yet'):'';feedback.classList.toggle('matched',!!confirmation.value&&matches);};
  password.addEventListener('input',update);confirmation.addEventListener('input',update);
 }
}
function mountAuthPanel(mode){
 clearTimeout(toast.timer);const previousNotice=document.querySelector('#toast');if(previousNotice){previousNotice.style.display='none';previousNotice.textContent='';}
 const panel=app.querySelector('.login');if(!panel)return;
 panel.querySelector('.brand')?.remove();
 const eyebrow=panel.querySelector('.eyebrow');if(eyebrow)eyebrow.textContent=mode==='setup'?'FIRST-TIME SETUP':mode==='reset'?'PASSWORD SETUP':'SCHOOL PORTAL';
 const layout=document.createElement('div');layout.className='auth-layout';
 const aside=document.createElement('aside');aside.className='auth-brand-panel';
 aside.innerHTML='<div class="school-identity"><span class="school-mark" aria-hidden="true">SD</span><div><div class="school-wordmark">Shambhu Dayal<br>Global School</div><div class="school-subtitle">School office</div></div></div><div class="auth-intro"><div class="auth-kicker">A LITTLE MORE TIME FOR WHAT MATTERS</div><h2>School days,<br>made simpler.</h2><p>One place for the everyday work that keeps your school moving.</p><div class="auth-features"><div><span aria-hidden="true">01</span><div><strong>Students, in one place</strong><p>Find class and parent contact details.</p></div></div><div><span aria-hidden="true">02</span><div><strong>Every school day, recorded</strong><p>Mark attendance and keep records up to date.</p></div></div><div><span aria-hidden="true">03</span><div><strong>A clearer school office</strong><p>Manage fee receipts and school supplies.</p></div></div></div></div><div class="auth-brand-footer">Shambhu Dayal Global School <span>Staff, student & parent access</span></div>';
 const stage=document.createElement('main');stage.className='auth-stage';
 const context=document.createElement('div');context.className='auth-context';context.innerHTML='<span>School office</span><span class="auth-access-badge">School accounts</span>';
 stage.append(context,panel);
 const note=document.createElement('p');note.className='auth-bottom-note';note.textContent='Your account shows only the school tools available to your role.';stage.append(note);
 app.replaceChildren(layout);layout.append(aside,stage);
 if(mode==='signin'){
  panel.querySelector('p.muted')?.remove();
  const help=document.createElement('div');help.className='signin-help';
  help.innerHTML='<button type="button" class="text-button" id="signin-help" aria-expanded="false" aria-controls="signin-help-content">Need an account or forgot your password?</button><div id="signin-help-content" hidden><strong>Your school administrator can help.</strong><p>Ask for a private password setup link. Open the link, choose a new password, then return here to sign in with your staff email. Links expire after 30 minutes.</p></div>';
  panel.append(help);help.querySelector('button').onclick=e=>{const content=help.querySelector('#signin-help-content');content.hidden=!content.hidden;e.currentTarget.setAttribute('aria-expanded',String(!content.hidden));};
 }else if(mode==='setup'){
  panel.querySelector('p.muted')?.remove();
  const note=document.createElement('p');note.className='setup-note';note.textContent='After setup, add teachers and accounts staff from Staff accounts.';panel.append(note);
 }
}
let staffLoadVersion=0;
async function usersPage(){
 const container=document.querySelector('#content');if(!container)return;
 const version=++staffLoadVersion;
 container.innerHTML='<div class="role-guide"><div><span class="role-icon" aria-hidden="true">A</span><strong>Administrator</strong><p>All school tools and staff access.</p></div><div><span class="role-icon" aria-hidden="true">T</span><strong>Teacher</strong><p>Students and daily attendance.</p></div><div><span class="role-icon" aria-hidden="true">₹</span><strong>Accounts staff</strong><p>Students, fee payments, and receipts.</p></div></div><div class="panel"><div class="panelhead"><div><h2>School accounts</h2><p id="staff-count" role="status">Loading school accounts…</p></div></div><div class="staff-filters"><label>Find a staff member<input id="staff-search" type="search" placeholder="Search by name or email"></label><label>Role<select id="staff-role"><option value="">All roles</option>'+Object.entries(roleNames).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')+'</select></label><label>Status<select id="staff-status"><option value="">All statuses</option><option value="active">Active</option><option value="pending">Needs password</option><option value="disabled">Disabled</option></select></label></div><div id="user-list" role="status">Loading…</div></div><div class="panel"><div class="panelhead"><div><h2>Recent account activity</h2><p>Sign-ins and changes to staff access.</p></div><span class="muted">Latest 100 events · India time</span></div><div id="auth-events">Loading…</div></div>';
 const present=()=>version===staffLoadVersion&&container.isConnected&&view==='users'&&!!authSession?.user&&has('users:manage');
 try{
  const [result,history]=await Promise.all([api('users'),api('auth-events')]);if(!present())return;
  const status=user=>!user.active?'disabled':user.password_ready?'active':'pending';
  const draw=()=>{
   if(!present())return;
   const query=container.querySelector('#staff-search').value.trim().toLowerCase(),role=container.querySelector('#staff-role').value,filter=container.querySelector('#staff-status').value;
   const users=result.users.filter(user=>(!query||(user.name+' '+user.email).toLowerCase().includes(query))&&(!role||role===user.role)&&(!filter||status(user)===filter));
   container.querySelector('#staff-count').textContent=users.length+' of '+result.users.length+' school accounts';
   container.querySelector('#user-list').innerHTML=table(['Account holder','Role','Status','Actions'],users.map(user=>'<tr><td><div class="staff-person"><span class="staff-initial" aria-hidden="true">'+esc(user.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase())+'</span><div><strong>'+esc(user.name)+(user.id===authSession.user.id?' <span class="you-label">You</span>':'')+'</strong><div class="muted">'+esc(user.email)+'</div></div></div></td><td>'+roleNames[user.role]+'</td><td><span class="pill '+(status(user)!=='active'?'warn':'')+'">'+({active:'Active',pending:'Needs password',disabled:'Disabled'}[status(user)])+'</span></td><td>'+(user.id===authSession.user.id?'<span class="muted">Manage from My account</span>':'<div class="staff-actions"><button class="secondary" data-edit-user="'+user.id+'">Edit access</button>'+(user.active?'<button class="secondary" data-reset-user="'+user.id+'">'+(user.password_ready?'Reset password':'Create password link')+'</button>':'')+'</div>')+'</td></tr>'),'No staff match these filters. Try another name, role, or status.');
   container.querySelectorAll('[data-edit-user]').forEach(button=>button.onclick=()=>editUser(result.users.find(user=>user.id===Number(button.dataset.editUser))));
   container.querySelectorAll('[data-reset-user]').forEach(button=>button.onclick=async()=>{button.disabled=true;button.textContent='Creating link…';try{const response=await api('users/'+button.dataset.resetUser+'/reset','POST',{});if(present())showResetLink(response.resetToken);}catch(e){toast(e.message);}finally{if(present())draw();}});
  };
  container.querySelector('#staff-search').oninput=draw;container.querySelector('#staff-role').onchange=draw;container.querySelector('#staff-status').onchange=draw;draw();
  const labels={admin_setup:'Administrator account created',migration_failed:'School password verification failed',account_created:'Staff account created',account_updated:'Staff access changed',reset_link_created:'Password setup link created',login:'Signed in',login_failed:'Sign-in attempt failed',logout:'Signed out',logout_all:'Signed out on all devices',password_reset:'Account password set',password_changed:'Password changed',local_admin_recovery:'Administrator recovery link created'};
  const names=new Map(result.users.map(user=>[String(user.id),user.name]));
  container.querySelector('#auth-events').innerHTML=table(['Staff member','Activity','Date and time'],history.events.map(event=>{const [action,id]=event.action.split(':');return '<tr><td>'+esc(event.name||'Unrecognized account')+'</td><td>'+esc(labels[action]||'Account activity')+(id?' <span class="muted">· '+esc(names.get(id)||'Staff member')+'</span>':'')+'</td><td>'+new Date(event.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+'</td></tr>';}),'No account activity yet.');
 }catch(e){if(present()){container.querySelector('#staff-count').textContent='Unable to load school accounts.';container.querySelector('#user-list').textContent=e.message;container.querySelector('#auth-events').textContent='Reopen Staff accounts to try again.';}}
}
