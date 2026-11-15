import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {createAuth} from './auth.js';
import {createSchool} from './school.js';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {randomUUID} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
if(process.env.NODE_ENV==='production'){
 const origin=process.env.ERP_ORIGIN;
 if(!origin||new URL(origin).protocol!=='https:'||new URL(origin).origin!==origin||process.env.ERP_SECURE_COOKIE!=='1')throw Error('Production requires ERP_ORIGIN set to an exact HTTPS origin and ERP_SECURE_COOKIE=1.');
}
const dir=resolve(process.env.ERP_DATA_DIR || resolve(root,'data')); mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(resolve(dir,'erp.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0));
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),total INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'confirmed',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS order_lines(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),product_id INTEGER NOT NULL REFERENCES products(id),name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),price INTEGER NOT NULL);
`);

const columns=new Set(db.prepare('PRAGMA table_info(customers)').all().map(c=>c.name));
for(const name of ['admission_no','class_name','guardian']){
 if(!columns.has(name))db.exec("ALTER TABLE customers ADD COLUMN "+name+" TEXT NOT NULL DEFAULT ''");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS student_admission_no ON customers(admission_no) WHERE admission_no<>''; CREATE TABLE IF NOT EXISTS fees(id INTEGER PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES customers(id),purpose TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),payment_date TEXT NOT NULL,method TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))); CREATE TABLE IF NOT EXISTS attendance(student_id INTEGER NOT NULL REFERENCES customers(id),date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Present','Absent','On leave')),PRIMARY KEY(student_id,date));");
function dateValue(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('Choose a valid date.');return value;}
function optional(value,label,max=80){if(value===undefined||value==='')return '';return text(value,label,max);}
const existingUsers=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
if(existingUsers&&!existingUsers.includes("'parent'")){mkdirSync(resolve(dir,'backups'),{recursive:true});db.prepare('VACUUM INTO ?').run(resolve(dir,'backups','before-portal-upgrade-'+randomUUID()+'.sqlite'));}
const auth=createAuth(db);
const school=createSchool(db,auth,dir);
if(process.env.ERP_DEMO==='1')school.seedDemo();
const port=Number(process.env.PORT || 3000);
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function text(value,label,max=160){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(label+' is required (maximum '+max+' characters).');return value.trim();}
function integer(value,label,min=0,max=100000000){if(!Number.isSafeInteger(value)||value<min||value>max)fail('Invalid '+label+'.');return value;}
async function body(req){let content='';for await(const chunk of req){content+=chunk;if(Buffer.byteLength(content)>65536)fail('Request too large.',413);}let parsed;try{parsed=JSON.parse(content||'{}');}catch{fail('Invalid JSON.');}if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail('JSON object required.');if(req.erpAccount){const live=auth.requireSession(req);auth.csrf(req,live);}return parsed;}
function state(){return {products:db.prepare('SELECT * FROM products ORDER BY name').all(),customers:db.prepare('SELECT * FROM customers ORDER BY name').all(),orders:db.prepare('SELECT o.*,c.name customer FROM orders o JOIN customers c ON o.customer_id=c.id ORDER BY o.id DESC LIMIT 500').all(),fees:db.prepare('SELECT f.*,c.name student,c.admission_no,c.class_name FROM fees f JOIN customers c ON c.id=f.student_id ORDER BY f.payment_date DESC,f.id DESC').all(),feeTotal:db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM fees WHERE void_reason=''").get().amount};}
const server=http.createServer(async(req,res)=>{
 const requestId=randomUUID(),started=performance.now();res.setHeader('X-Request-ID',requestId);
 if(process.env.ERP_REQUEST_LOG==='1')res.on('finish',()=>{if(req.url!=='/api/health')console.log(JSON.stringify({event:'request',requestId,method:req.method,path:req.url.split('?')[0],status:res.statusCode,durationMs:Math.round(performance.now()-started)}));});
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 try{
  const localPort=server.address().port;
  const allowedHosts=['127.0.0.1:'+localPort,'localhost:'+localPort,'[::1]:'+localPort];
  if(process.env.ERP_ORIGIN)allowedHosts.push(new URL(process.env.ERP_ORIGIN).host);
  if(!allowedHosts.includes(req.headers.host))fail('Unrecognized host.',421);
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')&&req.headers['sec-fetch-site']==='cross-site')fail('Cross-site requests are not allowed.',403);
  if(!['GET','HEAD'].includes(req.method)){
   const expectedOrigin=process.env.ERP_ORIGIN||((process.env.ERP_SECURE_COOKIE==='1'?'https://':'http://')+req.headers.host);if(req.headers.origin&&req.headers.origin!==expectedOrigin)fail('Origin rejected.',403);
   if(req.headers['content-type']?.split(';')[0]!=='application/json')fail('JSON content type required.',415);
  }
  if(path==='/api/health'&&req.method==='GET'){db.prepare('SELECT 1').get();return send(200,{ok:true});}
  if(await auth.route(path,req,res,body,send))return;
  if(path.startsWith('/api/')){
   const account=auth.requireSession(req);
   req.erpAccount=account;
   if(!['GET','HEAD'].includes(req.method))auth.csrf(req,account);
   if(path==='/api/state'&&req.method==='GET'){
    const result=state();
    if(account.role==='teacher'){result.fees=[];result.feeTotal=null;}
    if(account.role!=='admin'){result.products=[];result.orders=[];}
    return send(200,school.scopeState({...result,...school.state(account)},account));
   }
   if(await school.route(path,req,res,body,send,account))return;
   const permission=path.startsWith('/api/products')||path==='/api/orders'?'supplies':path.startsWith('/api/customers')?'students':path==='/api/fees'?'fees':path==='/api/attendance'?'attendance':null;
   if(permission)auth.allow(account,permission+':'+(['GET','HEAD'].includes(req.method)?'read':'write'));
   if(path==='/api/products'&&req.method==='POST'){const d=await body(req);db.prepare('INSERT INTO products(sku,name,price,stock) VALUES(?,?,?,?)').run(text(d.sku,'SKU',50),text(d.name,'Product name'),integer(d.price,'price'),integer(d.stock,'stock'));return send(201,{ok:true});}
   if(/^\/api\/products\/\d+$/.test(path)&&req.method==='PUT'){const d=await body(req);const result=db.prepare('UPDATE products SET stock=? WHERE id=?').run(integer(d.stock,'stock'),Number(path.split('/').pop()));if(!result.changes)fail('Product not found.',404);return send(200,{ok:true});}
   if(path==='/api/customers'&&req.method==='POST'){const d=await body(req);const live=auth.requireSession(req);auth.allow(live,'students:write');auth.csrf(req,live);return send(201,{ok:true,...school.createStudent(d,live)});}

   if(path==='/api/fees'&&req.method==='POST'){
    const d=await body(req);const live=auth.requireSession(req);auth.allow(live,'fees:write');auth.csrf(req,live);
    return send(201,school.payFee(d,live));
   }
   if(path==='/api/attendance'&&req.method==='GET'){
    const date=dateValue(new URL(req.url,'http://localhost').searchParams.get('date'));
    return send(200,{records:db.prepare('SELECT * FROM attendance WHERE date=?').all(date)});
   }
   if(path==='/api/attendance'&&req.method==='POST'){
    const d=await body(req);const date=dateValue(d.date);
    if(!Array.isArray(d.records)||!d.records.length||d.records.length>5000)fail('Choose attendance for at least one student (maximum 5000).');
    db.exec('BEGIN IMMEDIATE');try{
     const seen=new Set();
     for(const row of d.records){integer(row.student_id,'student',1);if(seen.has(row.student_id))fail('Duplicate student.');seen.add(row.student_id);
      if(!['Present','Absent','On leave'].includes(row.status))fail('Select Present, Absent, or On leave.');
      if(!db.prepare("SELECT id FROM customers WHERE id=? AND status='Active'").get(row.student_id))fail('Active student not found.');
      db.prepare('INSERT INTO attendance(student_id,date,status) VALUES(?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET status=excluded.status').run(row.student_id,date,row.status);
     }
     school.audit(account,'saved','attendance',null,date);db.exec('COMMIT');return send(200,{ok:true});
    }catch(error){db.exec('ROLLBACK');throw error;}
   }
   if(path==='/api/orders'&&req.method==='POST'){
    const d=await body(req);integer(d.customer_id,'customer',1);if(!Array.isArray(d.lines)||d.lines.length<1||d.lines.length>100)fail('Add between 1 and 100 order lines.');
    db.exec('BEGIN IMMEDIATE');try{
     if(!db.prepare("SELECT id FROM customers WHERE id=? AND status='Active'").get(d.customer_id))fail('Active student not found.');
     const seen=new Set();let total=0;
     const lines=d.lines.map(line=>{integer(line.product_id,'product',1);integer(line.quantity,'quantity',1,100000);if(seen.has(line.product_id))fail('Combine duplicate products into one line.');seen.add(line.product_id);const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(line.product_id);if(!p)fail('Active product not found.');if(p.stock<line.quantity)fail('Insufficient stock for '+p.name+'.');total+=p.price*line.quantity;return {...p,quantity:line.quantity};});
     if(!Number.isSafeInteger(total)||total>100000000000)fail('Order total is too large.');
     const order=db.prepare('INSERT INTO orders(customer_id,total) VALUES(?,?)').run(d.customer_id,total);
     for(const line of lines){db.prepare('INSERT INTO order_lines(order_id,product_id,name,quantity,price) VALUES(?,?,?,?,?)').run(order.lastInsertRowid,line.id,line.name,line.quantity,line.price);db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(line.quantity,line.id);}
     db.exec('COMMIT');return send(201,{id:Number(order.lastInsertRowid)});
    }catch(error){db.exec('ROLLBACK');throw error;}
   }
   fail('Not found.',404);
  }
  const assets={'/':['index.html','text/html; charset=utf-8'],'/auth-ui.js':['auth-ui.js','text/javascript; charset=utf-8'],'/school-ui.js':['school-ui.js','text/javascript; charset=utf-8'],'/portals.js':['portals.js','text/javascript; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/workspace.css':['workspace.css','text/css; charset=utf-8']};
  if(!assets[path]||!['GET','HEAD'].includes(req.method))fail('Not found.',404);
  const [file,type]=assets[path];res.writeHead(200,{'Content-Type':type});res.end(req.method==='HEAD'?undefined:readFileSync(resolve(root,'public',file)));
 }catch(error){const conflict=error.code?.startsWith('ERR_SQLITE')&&/UNIQUE constraint/.test(error.message);const status=error.status||(conflict?409:500);if(status===500)console.error(JSON.stringify({event:'request_error',requestId,message:error.message}));if(!res.destroyed)send(status,{error:status===500?'An unexpected error occurred. Please try again.':conflict?'A record with these unique details already exists.':error.message});}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=1000;
server.listen(port,process.env.ERP_HOST||'127.0.0.1',()=>console.log('ERP ready: http://127.0.0.1:'+server.address().port));

function close(){server.close(()=>{db.close();process.exit(0);});setTimeout(()=>server.closeAllConnections(),10000).unref();}
process.on('SIGTERM',close);process.on('SIGINT',close);

