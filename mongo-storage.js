import {MongoClient} from 'mongodb';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createApplication} from './application.js';
import {validateConfiguration} from './configuration.js';

// MongoDB holds the durable rows. Each request gets a private, in-memory SQL
// projection so the existing constraints, joins, and school transactions remain
// identical. A revision check and MongoDB transaction commit all changed rows
// together before any response or session cookie is sent to the browser.
const transactionOptions={readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'};
let connection;
export async function mongoConnection(){
 if(!process.env.MONGODB_URI)throw Error('Set MONGODB_URI to your MongoDB Atlas connection string.');
 if(!connection){
  connection=(async()=>{
   const client=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:5,serverSelectionTimeoutMS:10000,connectTimeoutMS:10000});
   try{
    await client.connect();const database=client.db(process.env.MONGODB_DB||'school_erp');
    await database.collection('erp_meta').updateOne({_id:'revision'},{$setOnInsert:{value:0,schemaVersion:1}},{upsert:true});
    return {client,database};
   }catch(error){await client.close();throw error;}
  })().catch(error=>{connection=undefined;throw error;});
 }
 return connection;
}
export async function closeMongo(){if(connection){const {client}=await connection;connection=undefined;await client.close();}}

function memoryDatabase(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA user_version=3;');
 createApplication(db,'',{mongo:true,initializeOnly:true});return db;
}
function schema(db){
 return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>{
  const columns=db.prepare(`PRAGMA table_info(${name})`).all();
  return {name,columns:columns.map(c=>c.name),keys:columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)};
 });
}
function records(db,tables){
 const result=new Map();
 for(const table of tables)for(const row of db.prepare(`SELECT * FROM ${table.name}`).all()){
  const _id=table.name+':'+JSON.stringify(table.keys.map(key=>row[key]));
  result.set(_id,{_id,table:table.name,row:{...row}});
 }
 return result;
}
function conflict(){return Object.assign(Error('School records changed during this request. Please try again.'),{status:409,revisionConflict:true});}

export async function loadMongoWorkspace(){
 const {client,database}=await mongoConnection(),session=client.startSession();let revision,documents;
 try{
  await session.withTransaction(async()=>{
   const meta=await database.collection('erp_meta').findOne({_id:'revision'},{session});
   if(meta?.schemaVersion!==1)throw Error('Unsupported MongoDB school schema.');
   revision=meta.value;documents=await database.collection('erp_records').find({},{session}).toArray();
  },transactionOptions);
 }finally{await session.endSession();}
 const db=memoryDatabase(),tables=schema(db),byName=new Map(tables.map(t=>[t.name,t]));
 try{
  db.exec('PRAGMA foreign_keys=OFF; BEGIN;');
  for(const document of documents){
   const table=byName.get(document.table);if(!table)throw Error('Unknown MongoDB school table.');
   const columns=table.columns.filter(c=>Object.hasOwn(document.row,c));
   db.prepare(`INSERT OR REPLACE INTO ${table.name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>document.row[c]));
  }
  db.exec('COMMIT; PRAGMA foreign_keys=ON;');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('MongoDB school records failed their relationship integrity check.');
 }catch(error){db.close();throw error;}
 const baseline=new Map(documents.map(d=>[d._id,d])),backups=[];
 db.createBackup=()=>{
  const filename='school-'+new Date().toISOString().slice(0,10)+'-'+randomUUID();
  backups.push({filename,rows:[...records(db,tables).values()]});return filename;
 };
 return {db,isEmpty:documents.length===0,async commit(){
  const current=records(db,tables),operations=[];
  for(const [_id,document]of current){const old=baseline.get(_id);if(!old||JSON.stringify(old.row)!==JSON.stringify(document.row))operations.push({replaceOne:{filter:{_id},replacement:document,upsert:true}});}
  for(const _id of baseline.keys())if(!current.has(_id))operations.push({deleteOne:{filter:{_id}}});
  // Check read-only responses too: a concurrent role change or revocation must
  // never be followed by sending an old account's school records.
  if(!operations.length&&!backups.length){const meta=await database.collection('erp_meta').findOne({_id:'revision'});if(meta.value!==revision)throw conflict();return;}
  const writeSession=client.startSession();
  try{
   await writeSession.withTransaction(async()=>{
    const changed=await database.collection('erp_meta').updateOne({_id:'revision',value:revision},{$inc:{value:1}},{session:writeSession});
    if(!changed.modifiedCount)throw conflict();
    if(operations.length)await database.collection('erp_records').bulkWrite(operations,{session:writeSession});
    for(const backup of backups){
     await database.collection('erp_backups').insertOne({_id:backup.filename,type:'manifest',createdAt:new Date(),rowCount:backup.rows.length,schemaVersion:1},{session:writeSession});
     if(backup.rows.length)await database.collection('erp_backups').insertMany(backup.rows.map(row=>({...row,_id:backup.filename+':'+row._id,backupId:backup.filename,type:'row'})),{session:writeSession});
    }
   },transactionOptions);
  }finally{await writeSession.endSession();}
 }};
}

function bufferedResponse(){
 return {statusCode:200,headers:new Map(),events:[],destroyed:false,on(name,listener){this.events.push([name,listener]);return this;},setHeader(name,value){this.headers.set(name.toLowerCase(),value);},writeHead(status,headers={}){this.statusCode=status;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);return this;},end(body){this.body=body;this.ended=true;}};
}
let staticApplication;
export function storageFailureMessage(error){
 if(error.status)return error.message;
 if(error.code===18)return 'MongoDB authentication failed. Check the Atlas database username and password in MONGODB_URI in Vercel, then redeploy.';
 if(error.code===13)return 'MongoDB access was denied. Give the Atlas database user read and write access to the school database.';
 if(error.name==='MongoParseError')return 'MONGODB_URI is invalid. Use the Atlas connection string without HTML, extra text, or surrounding quotes, then redeploy.';
 if(error.name==='MongoServerSelectionError'||error.name==='MongoNetworkError')return 'The deployment cannot reach MongoDB Atlas. Check Atlas Network Access, cluster availability, and the connection hostname.';
 return 'School storage is unavailable. Check the MongoDB and deployment environment settings.';
}
export async function mongoHandler(req,res){
 try{
  validateConfiguration();
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/api/')){
   staticApplication??=createApplication(memoryDatabase(),'',{mongo:true,initializeOnly:true});
   return await staticApplication.handler(req,res);
  }
  const chunks=[];let size=0;
  if(req.body!==undefined){
   const parsed=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
   size=parsed.length;chunks.push(parsed);
  }else for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>65536)throw Object.assign(Error('Request too large.'),{status:413});chunks.push(Buffer.from(chunk));}
  if(size>65536)throw Object.assign(Error('Request too large.'),{status:413});
  const body=Buffer.concat(chunks);
  for(let attempt=0;attempt<5;attempt++){
   const workspace=await loadMongoWorkspace();
   try{
    const replay=Readable.from(body.length?[body]:[]);Object.assign(replay,{url:req.url,method:req.method,headers:req.headers,socket:req.socket});
    const output=bufferedResponse(),application=createApplication(workspace.db,'',{mongo:true});
    await application.handler(replay,output);
    await workspace.commit();
    if(res.destroyed)return;
    for(const [name,listener]of output.events)res.on(name,listener);
    for(const [name,value]of output.headers)res.setHeader(name,value);
    res.writeHead(output.statusCode);res.end(output.body);return;
   }catch(error){if(!error.revisionConflict||attempt===4)throw error;}
   finally{workspace.db.close();}
  }
 }catch(error){
  // Driver errors can contain hostnames and connection details. Never expose
  // the original error/URI in an HTTP response or application log.
  const status=error.status||503;
  console.error(JSON.stringify({event:'mongo_request_failed',code:error.code||error.name,status}));
  if(!res.headersSent&&!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:storageFailureMessage(error)}));}
 }
}
