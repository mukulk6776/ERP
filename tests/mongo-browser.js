import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {MongoMemoryReplSet} from 'mongodb-memory-server-core';

const cluster=await MongoMemoryReplSet.create({replSet:{count:1,storageEngine:'wiredTiger'}});
try{
 for(const suite of ['tests/workflows-browser.js','tests/browser-smoke.js']){
  console.log('Running '+suite+' with MongoDB storage.');
  const child=spawn(process.execPath,[suite],{env:{...process.env,ERP_BROWSER_TIMEOUT:'180000',MONGODB_URI:cluster.getUri(),MONGODB_DB:'browser_'+randomUUID().replaceAll('-','')},windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error(suite+' failed with exit code '+code);
 }
}finally{await cluster.stop();}
