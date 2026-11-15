import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const COST={N:131072,r:8,p:1,maxmem:192*1024*1024};
const IDLE=30*60*1000,ABSOLUTE=8*60*60*1000,RESET=30*60*1000;
export const roles={
 admin:['students:read','students:write','attendance:read','attendance:write','fees:read','fees:write','supplies:read','supplies:write','users:manage','classes:read','classes:write','staff:read','staff:write','academics:read','academics:write','library:read','library:write','transport:read','transport:write','notices:write','settings:write'],
 teacher:['students:read','attendance:read','attendance:write','classes:read','staff:read','academics:read','academics:write','library:read'],
 accountant:['students:read','fees:read','fees:write','classes:read','staff:read','payroll:read','payroll:write','leave:create'],
 parent:['portal:read','leave:create'],
 student:['portal:read','homework:submit','leave:create']
};
roles.admin.push('payroll:read','payroll:write','homework:write','homework:read','leave:create','leave:review');
roles.teacher.push('homework:read','homework:write','leave:create');
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active});
function error(message,status=400){throw Object.assign(new Error(message),{status});}
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>160)error('Enter a name of up to 160 characters.');return value.trim();}
function email(value){if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))error('Enter a valid email address.');return value.trim().toLowerCase();}
function password(value){if(typeof value!=='string'||value.length<15||value.length>128)error('Use a password between 15 and 128 characters.');return value;}
let busy=0;
async function key(password,salt,legacy=false){
 if(busy>=2)error('Sign-in is busy. Please try again in a moment.',429);
 busy++;try{return await derive(password,salt,64,legacy?{}:COST);}finally{busy--;}
}
async function encode(password){const salt=randomBytes(16).toString('hex');return 'scrypt-v1:'+salt+':'+(await key(password,salt)).toString('hex');}
async function verify(password,stored){
 if(typeof password!=='string'||password.length>256)return false;
 const parts=stored.split(':');const legacy=parts.length===2;const salt=parts[legacy?0:1],digest=parts[legacy?1:2];
 if(!salt||!digest)return false;const actual=await key(legacy?password.trim():password,salt,legacy),expected=Buffer.from(digest,'hex');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function createAuth(db){
 const userSchema="(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT,role TEXT NOT NULL CHECK(role IN ('admin','teacher','accountant','parent','student')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))";
 const oldSchema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
 if(oldSchema&&!oldSchema.includes("'parent'")){
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try{db.exec('CREATE TABLE users_upgrade'+userSchema+'; INSERT INTO users_upgrade SELECT * FROM users; DROP TABLE users; ALTER TABLE users_upgrade RENAME TO users;');if(db.prepare('PRAGMA foreign_key_check').all().length)error('Account migration failed its integrity check.',500);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON;');}
 }
 db.exec('CREATE TABLE IF NOT EXISTS users'+userSchema+"; CREATE TABLE IF NOT EXISTS user_students(user_id INTEGER NOT NULL REFERENCES users(id),student_id INTEGER NOT NULL REFERENCES customers(id),PRIMARY KEY(user_id,student_id)); CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS auth_events(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));");
 const studentIds=userId=>db.prepare('SELECT student_id FROM user_students WHERE user_id=? ORDER BY student_id').all(userId).map(r=>r.student_id);
 function validateLinks(role,values,allowInactive=false){
  if(!['parent','student'].includes(role))return [];
  if(!Array.isArray(values)||!values.length||values.length>20||(role==='student'&&values.length!==1)||new Set(values).size!==values.length)error(role==='student'?'Link a student account to exactly one student.':'Link a parent account to at least one student (maximum 20).');
  for(const id of values)if(!Number.isSafeInteger(id)||!db.prepare("SELECT 1 FROM customers WHERE id=? AND (?=1 OR status='Active')").get(id,Number(allowInactive)))error('Choose active students to link to this account.');
  return values;
 }
 const dummy='scrypt-v1:'+randomBytes(16).toString('hex')+':'+randomBytes(64).toString('hex');
 function audit(user,action){db.prepare('INSERT INTO auth_events(user_id,action) VALUES(?,?)').run(user||null,action);}
 function usersExist(){return !!db.prepare('SELECT 1 FROM users LIMIT 1').get();}
 function legacy(){return db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;}
 const setupTokenRequired=()=>process.env.NODE_ENV==='production'&&!usersExist()&&!legacy();
 if(setupTokenRequired()&&(!process.env.ERP_SETUP_TOKEN||process.env.ERP_SETUP_TOKEN.length<32||process.env.ERP_SETUP_TOKEN.length>256))error('Set ERP_SETUP_TOKEN to a random secret of 32–256 characters before the first production launch.',500);
 function limit(req,identity=''){
  const now=Date.now();
  const limits=[['ip:'+req.socket.remoteAddress,300]];
  if(identity)limits.push(['identity:'+identity,10]);
  for(const [value,max] of limits){
   const id=hash(value);const row=db.prepare('SELECT * FROM auth_limits WHERE key=?').get(id);
   if(row&&row.expires_at>now&&row.count>=max)error('Too many attempts. Please try again in 15 minutes.',429);
  }
  for(const [value]of limits)db.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').run(hash(value),now+900000,now,now);
 }
 function cookie(res,value,maxAge=28800){res.setHeader('Set-Cookie','erp_session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(process.env.ERP_SECURE_COOKIE==='1'?'; Secure':''));}
 function session(req){
  const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('erp_session='))?.slice(12);
  if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
  const record=db.prepare('SELECT s.*,u.name,u.email,u.role,u.active FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash(raw));
  if(!record)return null;
  if(!record.active||record.expires_at<=Date.now()||record.last_seen+IDLE<=Date.now()){db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(record.token_hash);return null;}
  db.prepare('UPDATE auth_sessions SET last_seen=? WHERE token_hash=?').run(Date.now(),record.token_hash);
  return {...record,user:{id:record.user_id,name:record.name,email:record.email,role:record.role,active:true}};
 }
 function describe(record){return {authenticated:!!record,user:record?.user||null,permissions:record?roles[record.role]:[],studentIds:record?studentIds(record.user.id):[],csrfToken:record?.csrf_token||null,setupRequired:!usersExist(),setupTokenRequired:setupTokenRequired(),migrationRequired:!usersExist()&&!!legacy()};}
 function issue(req,res,user){
  const old=session(req);if(old)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(old.token_hash);
  const raw=token(),csrf=token(),now=Date.now();
  db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run(hash(raw),user.id,csrf,now,now,now+ABSOLUTE);cookie(res,raw);
  return describe({user:publicUser(user),role:user.role,csrf_token:csrf});
 }
 function requireSession(req){const record=session(req);if(!record)error('Your session has ended. Please sign in again.',401);return record;}
 function csrf(req,record){const supplied=req.headers['x-csrf-token'];if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||supplied.length!==record.csrf_token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(record.csrf_token)))error('Security check failed. Refresh the page and try again.',403);}
 function allow(record,permission){if(!roles[record.role]?.includes(permission))error('Your account does not have permission to do this.',403);}
 function reset(userId){db.prepare('DELETE FROM password_resets WHERE user_id=?').run(userId);const raw=token();db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(hash(raw),userId,Date.now()+RESET);return raw;}
 function resetLink(value){
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))error('This link is invalid or has expired. Ask your school administrator for a new link.');
  const row=db.prepare('SELECT r.*,u.name,u.email,u.active FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?').get(hash(value));
  if(!row||!row.active||row.expires_at<=Date.now())error('This link is invalid or has expired. Ask your school administrator for a new link.');
  return row;
 }
 const cleanup=setInterval(()=>{const now=Date.now();db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR last_seen<=?').run(now,now-IDLE);db.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(now);db.prepare('DELETE FROM auth_limits WHERE expires_at<=?').run(now);},60000);cleanup.unref();
 async function route(path,req,res,body,send){
  if(path==='/api/session'&&req.method==='GET'){send(200,describe(session(req)));return true;}
  if(path==='/api/setup'&&req.method==='POST'){
   if(usersExist())error('School account setup has already been completed.',409);
   limit(req,'setup');const d=await body(req);
   if(setupTokenRequired()&&(typeof d.setupToken!=='string'||d.setupToken.length>256||!timingSafeEqual(Buffer.from(hash(d.setupToken)),Buffer.from(hash(process.env.ERP_SETUP_TOKEN)))))error('Enter the deployment setup key provided by the server administrator.',401);
   if(legacy()&&!await verify(d.currentPassword,legacy())){audit(null,'migration_failed');error('Enter the existing school password to continue.',401);}
   const fullName=name(d.name),address=email(d.email),secret=password(d.password);const encoded=await encode(secret);
   // Recheck after asynchronous password hashing: only one first administrator may win.
   db.exec('BEGIN IMMEDIATE');let user;
   try{if(usersExist())error('School account setup has already been completed.',409);const row=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(fullName,address,encoded);db.prepare("DELETE FROM settings WHERE key='password'").run();audit(Number(row.lastInsertRowid),'admin_setup');db.exec('COMMIT');user=db.prepare('SELECT * FROM users WHERE id=?').get(row.lastInsertRowid);}catch(e){db.exec('ROLLBACK');throw e;}
   send(201,issue(req,res,user));return true;
  }
  if(path==='/api/login'&&req.method==='POST'){
   const d=await body(req);const address=typeof d.email==='string'?d.email.trim().toLowerCase().slice(0,254):'';
   limit(req,address);const user=db.prepare('SELECT * FROM users WHERE email=?').get(address);
   const valid=await verify(d.password,user?.password_hash||dummy);
   // Re-read after hashing so disabling an account cannot race with login.
   const current=user&&db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
   if(!valid||!current?.active||current.password_hash!==user.password_hash){audit(user?.id,'login_failed');error('Email or password is incorrect.',401);}
   db.prepare('DELETE FROM auth_limits WHERE key=?').run(hash('identity:'+address));
   audit(user.id,'login');send(200,issue(req,res,current));return true;
  }
  if(path==='/api/validate-reset'&&req.method==='POST'){
   limit(req);const d=await body(req),row=resetLink(d.token);
   send(200,{name:row.name,email:row.email,expiresAt:row.expires_at});return true;
  }
  if(path==='/api/reset-password'&&req.method==='POST'){
   limit(req);const d=await body(req);resetLink(d.token);
   const encoded=await encode(password(d.password));
   db.exec('BEGIN IMMEDIATE');try{
    const valid=resetLink(d.token);
    const previous=session(req);
    if(previous)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(previous.token_hash);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(encoded,valid.user_id);
    db.prepare('DELETE FROM auth_limits WHERE key=?').run(hash('identity:'+valid.email));
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(valid.user_id);db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(valid.user_id);audit(valid.user_id,'password_reset');db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   cookie(res,'',0);send(200,{ok:true});return true;
  }
  const authPaths=['/api/logout','/api/logout-all','/api/change-password','/api/users','/api/auth-events'];
  if(!authPaths.includes(path)&&!/^\/api\/users\/\d+(\/reset)?$/.test(path))return false;
  const current=requireSession(req);req.erpAccount=current;if(!['GET','HEAD'].includes(req.method))csrf(req,current);
  if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(current.token_hash);cookie(res,'',0);audit(current.user_id,'logout');send(200,{ok:true});return true;}
  if(path==='/api/logout-all'&&req.method==='POST'){db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(current.user_id);cookie(res,'',0);audit(current.user_id,'logout_all');send(200,{ok:true});return true;}
  if(path==='/api/change-password'&&req.method==='POST'){
   limit(req,'change:'+current.user_id);const d=await body(req);const original=db.prepare('SELECT password_hash FROM users WHERE id=?').get(current.user_id).password_hash;
   if(!await verify(d.currentPassword,original))error('Your current password is incorrect.');
   const secret=password(d.password);if(d.currentPassword===secret)error('Choose a different password.');const encoded=await encode(secret);
   db.exec('BEGIN IMMEDIATE');try{
    requireSession(req);
    const updated=db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND active=1').run(encoded,current.user_id,original);
    if(!updated.changes)error('Your account changed. Please sign in again.',401);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(current.user_id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(current.user_id);audit(current.user_id,'password_changed');db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   send(200,issue(req,res,db.prepare('SELECT * FROM users WHERE id=?').get(current.user_id)));return true;
  }
  allow(current,'users:manage');
  if(path==='/api/users'&&req.method==='GET'){send(200,{users:db.prepare('SELECT id,name,email,role,active,created_at,password_hash IS NOT NULL AS password_ready FROM users ORDER BY name').all().map(u=>({...u,student_ids:studentIds(u.id)}))});return true;}
  if(path==='/api/auth-events'&&req.method==='GET'){send(200,{events:db.prepare('SELECT a.id,a.action,a.created_at,u.name FROM auth_events a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100').all()});return true;}
  if(path==='/api/users'&&req.method==='POST'){
   const d=await body(req);allow(requireSession(req),'users:manage');if(!Object.hasOwn(roles,d.role))error('Choose a valid role.');const links=validateLinks(d.role,d.student_ids);let result;
   db.exec('BEGIN IMMEDIATE');try{const row=db.prepare('INSERT INTO users(name,email,role) VALUES(?,?,?)').run(name(d.name),email(d.email),d.role);const id=Number(row.lastInsertRowid);for(const student of links)db.prepare('INSERT INTO user_students VALUES(?,?)').run(id,student);audit(current.user_id,'account_created:'+id);result={id,resetToken:reset(id),expiresInMinutes:30};db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}send(201,result);return true;
  }
  if(/^\/api\/users\/\d+\/reset$/.test(path)&&req.method==='POST'){
   const id=Number(path.split('/')[3]);if(id===current.user_id)error('Use Change password in My account for your own account.');const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!user?.active)error('Account not found or disabled.',404);
   audit(current.user_id,'reset_link_created:'+id);send(200,{resetToken:reset(id),expiresInMinutes:30});return true;
  }
  if(/^\/api\/users\/\d+$/.test(path)&&req.method==='PATCH'){
   const id=Number(path.split('/')[3]);if(id===current.user_id)error('You cannot change your own role or disable your own account.');
   const d=await body(req);allow(requireSession(req),'users:manage');if(!Object.hasOwn(roles,d.role)||typeof d.active!=='boolean')error('Choose a valid role and account status.');const links=validateLinks(d.role,d.student_ids??studentIds(id),!d.active);
   if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))error('Account not found.',404);
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(d.role,Number(d.active),id);
    db.prepare('DELETE FROM user_students WHERE user_id=?').run(id);for(const student of links)db.prepare('INSERT INTO user_students VALUES(?,?)').run(id,student);
    if(!db.prepare("SELECT 1 FROM users WHERE role='admin' AND active=1 AND password_hash IS NOT NULL").get())error('Keep at least one active administrator.');
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(id);audit(current.user_id,'account_updated:'+id);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   send(200,{ok:true});return true;
  }
  error('Not found.',404);
 }
 return {route,session,requireSession,csrf,allow,permissions:record=>roles[record.role]||[],studentIds:record=>studentIds(record.user_id)};
}

