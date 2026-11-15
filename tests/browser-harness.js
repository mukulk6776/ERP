import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserBinary} from './browser-binary.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function startBrowser(){
 const dir=mkdtempSync(join(tmpdir(),'school-workflow-')),pending=new Map(),errors=[];let server,browser,ws,nextId=0;
 const close=async()=>{ws?.close();browser?.kill();server?.kill();await sleep(500);try{rmSync(dir,{recursive:true,force:true});}catch{}};
 try{
  server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',ERP_DATA_DIR:join(dir,'data'),ERP_DEMO:'1',NODE_ENV:'test'},windowsHide:true});
  const base=await new Promise((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(Error('Server startup timeout: '+error)),15000);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.stderr.on('data',chunk=>error+=chunk);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+error));});});
  browser=spawn(browserBinary(),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+join(dir,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
  let browserError;browser.once('error',e=>browserError=e);
  const portFile=join(dir,'profile','DevToolsActivePort');let target;
  for(let i=0;i<100&&!target;i++){
   if(browserError)throw browserError;
   try{if(existsSync(portFile)){const port=readFileSync(portFile,'utf8').split('\n')[0];const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=targets.find(t=>t.type==='page');}}catch{}
   if(!target)await sleep(200);
  }
  if(!target)throw Error('Chrome debugger did not become ready.');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result);}}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Log.entryAdded'&&message.params.entry.source==='security')errors.push(message.params.entry);};
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},Number(process.env.ERP_BROWSER_TIMEOUT||60000));pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await rpc('Runtime.enable');await rpc('Log.enable');await rpc('Page.enable');await rpc('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await rpc('Page.navigate',{url:base});
  await evaluate(`(async()=>{for(let i=0;i<150;i++){if(document.querySelector('#login'))return;await new Promise(r=>setTimeout(r,50));}throw Error('Initial setup did not load.');})()`);
  const screenshot=async path=>{const result=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(path,Buffer.from(result.data,'base64'));};
  return {rpc,evaluate,screenshot,errors,close,base};
 }catch(error){await close();throw error;}
}
