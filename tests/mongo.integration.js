import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MongoMemoryReplSet} from 'mongodb-memory-server-core';
import {MongoClient} from 'mongodb';
import {DatabaseSync} from 'node:sqlite';
import http from 'node:http';
import vercelHandler from '../api/index.js';
import {createApplication} from '../application.js';
import {migrateToMongo} from '../tools/migrate-to-mongo.js';
import {closeMongo} from '../mongo-storage.js';

test('MongoDB preserves school workflows, concurrent writes, sessions, snapshots, and restarts',async t=>{
 const cluster=await MongoMemoryReplSet.create({replSet:{count:1,storageEngine:'wiredTiger'}});
 const database='erp_test_'+randomUUID().replaceAll('-',''),uri=cluster.getUri(),dir=mkdtempSync(join(tmpdir(),'erp-mongo-'));
 const inspector=new MongoClient(uri);await inspector.connect();const mongo=inspector.db(database);
 const children=[];
 t.after(async()=>{for(const child of children)if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});await inspector.close();await cluster.stop();rmSync(dir,{recursive:true,force:true});});
 async function start(){
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',ERP_DATA_DIR:dir,MONGODB_URI:uri,MONGODB_DB:database,ERP_DEMO:'1',NODE_ENV:'test'},windowsHide:true});children.push(child);
  const base=await new Promise((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(Error('Startup timeout: '+error)),20000);child.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',data=>error+=data);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+error));});});
  return {base,child};
 }
 const one=await start(),two=await start();let cookie='',csrf='';
 async function call(path,method='GET',data,base=one.base,credentials=true){
  const response=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(credentials?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  if(credentials){const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];}
  const result=await response.json();if(credentials&&result.csrfToken)csrf=result.csrfToken;return {status:response.status,data:result};
 }
 const setup=await call('setup','POST',{name:'Mongo Administrator',email:'mongo@school.test',password:'private mongo administrator password'});
 assert.equal(setup.status,201,JSON.stringify(setup));
 assert.equal(existsSync(join(dir,'erp.sqlite')),false,'MongoDB mode must not write a local SQLite file');
 let state=(await call('state')).data;assert.equal(state.customers.length,72);
 assert.equal((await call('state','GET',undefined,two.base)).data.customers.length,72,'Another server must see persisted records and sessions');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
 const invoice=await call('invoices','POST',{student_id:1,purpose:'Mongo tuition',amount:10000,due_date:day,academic_year:'2026–27'});assert.equal(invoice.status,201);
 const payment={student_id:1,invoice_id:invoice.data.id,purpose:'Mongo tuition',amount:7000,payment_date:day,method:'Cash'};
 const paid=await Promise.all([call('fees','POST',{...payment,request_id:'mongo-first'}),call('fees','POST',{...payment,request_id:'mongo-second'},two.base)]);
 assert.deepEqual(paid.map(r=>r.status).sort(),[201,400],JSON.stringify(paid));
 const successful=paid.find(r=>r.status===201),key=paid[0].status===201?'mongo-first':'mongo-second';
 assert.equal((await call('fees','POST',{...payment,request_id:key})).data.id,successful.data.id,'Payment retry must not create another receipt');
 state=(await call('state')).data;assert.equal(state.invoices.find(i=>i.id===invoice.data.id).balance,3000);
 const supply=await call('products','POST',{name:'Mongo notebook',sku:'MONGO-BOOK',price:5000,stock:1});assert.equal(supply.status,201);
 const product=(await call('state')).data.products.find(p=>p.sku==='MONGO-BOOK');
 const issues=await Promise.all([call('orders','POST',{customer_id:1,lines:[{product_id:product.id,quantity:1}]}),call('orders','POST',{customer_id:2,lines:[{product_id:product.id,quantity:1}]},two.base)]);
 assert.deepEqual(issues.map(r=>r.status).sort(),[201,400],JSON.stringify(issues));
 const third=await start();assert.equal((await call('state','GET',undefined,third.base)).data.products.find(p=>p.id===product.id).stock,0);
 const backup=await call('backups','POST',{});assert.equal(backup.status,201,JSON.stringify(backup));assert.equal(backup.data.storage,'mongodb');
 const manifest=await mongo.collection('erp_backups').findOne({_id:backup.data.filename});assert.ok(manifest.rowCount>100);
 assert.equal(await mongo.collection('erp_backups').countDocuments({backupId:backup.data.filename}),manifest.rowCount);
 const invalid=await call('attendance','POST',{date:day,records:[{student_id:1,status:'Absent'},{student_id:999999,status:'Present'}]});assert.equal(invalid.status,400);
 const record=await mongo.collection('erp_records').findOne({table:'products','row.sku':'MONGO-BOOK'});assert.equal(record.row.stock,0);
 assert.ok(await mongo.collection('erp_records').countDocuments({table:'auth_sessions'}));
 const logout=await call('logout-all','POST',{});assert.equal(logout.status,200);
 assert.equal((await call('state','GET',undefined,two.base)).status,401,'Revocation must apply across instances');
 // The legacy file can be imported into a separate, empty MongoDB database.
 const sourcePath=join(dir,'source.sqlite'),source=new DatabaseSync(sourcePath);createApplication(source,dir,{mongo:true,initializeOnly:true}).school.seedDemo();source.close();
 const previousUri=process.env.MONGODB_URI,previousDb=process.env.MONGODB_DB;
 process.env.MONGODB_URI=uri;process.env.MONGODB_DB=database+'_import';
 try{
  assert.equal(await migrateToMongo(sourcePath),72);await assert.rejects(migrateToMongo(sourcePath),/already contains/);const reopened=new DatabaseSync(sourcePath,{readOnly:true});assert.equal(reopened.prepare('SELECT COUNT(*) n FROM customers').get().n,72);reopened.close();
  await closeMongo();process.env.MONGODB_DB=database;
  const originalProduction={NODE_ENV:process.env.NODE_ENV,VERCEL:process.env.VERCEL,ERP_ORIGIN:process.env.ERP_ORIGIN,ERP_SECURE_COOKIE:process.env.ERP_SECURE_COOKIE};
  Object.assign(process.env,{NODE_ENV:'production',VERCEL:'1',ERP_ORIGIN:'https://school.test',ERP_SECURE_COOKIE:'1'});
  const functionServer=http.createServer(async(req,res)=>{
   // Vercel's Node runtime can provide a parsed body with an exhausted stream.
   if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;req.body=JSON.parse(raw||'{}');}
   await vercelHandler(req,res);
  });
  try{
   await new Promise(resolve=>functionServer.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+functionServer.address().port;
   const signedIn=await call('login','POST',{email:'mongo@school.test',password:'private mongo administrator password'},base);assert.equal(signedIn.status,200,JSON.stringify(signedIn));
   assert.equal((await call('state','GET',undefined,base)).data.customers.length,72);
   assert.equal((await call('attendance','POST',{date:day,records:[{student_id:1,status:'On leave'}]},base)).status,200,'Vercel parsed request bodies must work');
   assert.equal((await call('attendance?date='+day,'GET',undefined,base)).data.records.find(r=>r.student_id===1).status,'On leave');
   assert.equal(existsSync(join(dir,'erp.sqlite')),false);
  }finally{await new Promise(resolve=>functionServer.close(resolve));for(const [key,value]of Object.entries(originalProduction))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
 finally{await closeMongo();if(previousUri===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=previousUri;if(previousDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=previousDb;}
});
