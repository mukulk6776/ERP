import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadMongoWorkspace,closeMongo} from '../mongo-storage.js';

export async function migrateToMongo(sourcePath){
 if(!existsSync(sourcePath))throw Error('The source SQLite database does not exist.');
 const workspace=await loadMongoWorkspace();let source;
 try{
  if(!workspace.isEmpty)throw Error('MongoDB already contains school records. Choose a new empty MONGODB_DB.');
  source=new DatabaseSync(sourcePath,{readOnly:true});source.exec('BEGIN;');
  const db=workspace.db;
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.exec('PRAGMA foreign_keys=OFF; BEGIN;');
  for(const {name}of tables){
   if(!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))continue;
   const known=new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(c=>c.name));
   for(const row of source.prepare(`SELECT * FROM ${name}`).all()){
    const columns=Object.keys(row).filter(c=>known.has(c));
    db.prepare(`INSERT OR REPLACE INTO ${name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));
   }
  }
  db.exec('COMMIT; PRAGMA foreign_keys=ON;');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Source records failed their relationship integrity check.');
  const count=db.prepare('SELECT COUNT(*) n FROM customers').get().n;
  await workspace.commit();return count;
 }finally{source?.close();workspace.db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const path=resolve(process.argv[2]||resolve(process.env.ERP_DATA_DIR||'data','erp.sqlite'));
  const count=await migrateToMongo(path);console.log('Migrated school records to MongoDB ('+count+' students). The source SQLite file was not changed.');
 }catch(error){console.error(error.status?error.message:'Migration failed. Check the source database and MongoDB configuration; the destination must be empty.');process.exitCode=1;}
 finally{await closeMongo();}
}
