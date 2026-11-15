import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {validateConfiguration} from '../configuration.js';
import vercelHandler from '../api/index.js';
import {storageFailureMessage} from '../mongo-storage.js';

test('database connection diagnostics identify actionable categories without leaking driver messages',()=>{
 const privateText='mongodb://private-user:private-password@private-host/';
 for(const [error,expected]of [[{code:18},/authentication failed/],[{code:13},/access was denied/],[{name:'MongoParseError'},/MONGODB_URI is invalid/],[{name:'MongoServerSelectionError'},/cannot reach/],[{name:'MongoNetworkError'},/cannot reach/],[{name:'UnknownError'},/storage is unavailable/]]){
  const message=storageFailureMessage({...error,message:privateText});assert.match(message,expected);assert.equal(message.includes('private-password'),false);assert.equal(message.includes('private-host'),false);
 }
});

test('Vercel reports missing production settings without exposing credentials or falling back to local storage',async()=>{
 const keys=['VERCEL','NODE_ENV','MONGODB_URI','ERP_ORIGIN','ERP_SECURE_COOKIE'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const server=http.createServer(vercelHandler);
 try{
  Object.assign(process.env,{VERCEL:'1',NODE_ENV:'production'});for(const key of ['MONGODB_URI','ERP_ORIGIN','ERP_SECURE_COOKIE'])delete process.env[key];
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/session';
  const missing=await fetch(url),first=await missing.json();assert.equal(missing.status,503);assert.match(first.error,/add MONGODB_URI/);
  process.env.MONGODB_URI='mongodb://private-user:private-password@127.0.0.1:1/';
  const wrongOrigin=await fetch(url),second=await wrongOrigin.json();assert.equal(wrongOrigin.status,503);assert.match(second.error,/ERP_ORIGIN/);assert.equal(JSON.stringify(second).includes('private-password'),false);
  process.env.ERP_ORIGIN='https://school.example/';process.env.ERP_SECURE_COOKIE='1';assert.throws(validateConfiguration,/without a trailing slash/);
  process.env.ERP_ORIGIN='https://school.example';assert.doesNotThrow(validateConfiguration);
 }finally{await new Promise(resolve=>server.close(resolve));for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
