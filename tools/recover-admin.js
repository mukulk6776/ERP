import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
// This utility requires local access to the school database. Do not expose it as an HTTP route.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const path=resolve(process.env.ERP_DATA_DIR||resolve(root,'data'),'erp.sqlite');
const address=process.argv[2]?.trim().toLowerCase();
if(!address||!existsSync(path)){console.error('Usage: node tools/recover-admin.js administrator@email.example');process.exit(1);}
const db=new DatabaseSync(path);
try{
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get())throw Error('Complete administrator account setup in the browser first.');
 const user=db.prepare("SELECT id FROM users WHERE email=? AND role='admin' AND active=1").get(address);
 if(!user)throw Error('No active administrator matches that email.');
 const raw=randomBytes(32).toString('hex'),digest=createHash('sha256').update(raw).digest('hex');
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
  db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(digest,user.id,Date.now()+1800000);
  db.prepare("INSERT INTO auth_events(user_id,action) VALUES(?,'local_admin_recovery')").run(user.id);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 const origin=process.env.ERP_ORIGIN||'http://127.0.0.1:'+(process.env.PORT||3000);
 console.log('Private one-use recovery link (expires in 30 minutes):\n'+origin+'/#reset='+raw);
} catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
