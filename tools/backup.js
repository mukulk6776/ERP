import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=resolve(process.env.ERP_DATA_DIR||resolve(root,'data'));
if(!existsSync(resolve(dir,'erp.sqlite')))throw Error('No school database found. Start the ERP first.');
mkdirSync(resolve(dir,'backups'),{recursive:true});
const destination=resolve(dir,'backups','school-'+new Date().toISOString().slice(0,10)+'-'+randomUUID()+'.sqlite');
const db=new DatabaseSync(resolve(dir,'erp.sqlite'));
try{db.prepare('VACUUM INTO ?').run(destination);console.log('Backup created: '+destination);}finally{db.close();}
