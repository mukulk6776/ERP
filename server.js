import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname} from 'node:path';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createApplication} from './application.js';
import {validateConfiguration} from './configuration.js';

validateConfiguration();
let db,handler;
if(process.env.MONGODB_URI){
 const {mongoHandler}=await import('./mongo-storage.js');handler=mongoHandler;
}else{
 const root=dirname(fileURLToPath(import.meta.url)),dir=resolve(process.env.ERP_DATA_DIR||resolve(root,'data'));
 mkdirSync(dir,{recursive:true});db=new DatabaseSync(resolve(dir,'erp.sqlite'));
 handler=createApplication(db,dir).handler;
}
const server=http.createServer(handler);
server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=1000;
server.listen(Number(process.env.PORT||3000),process.env.ERP_HOST||'127.0.0.1',()=>console.log('ERP ready: http://127.0.0.1:'+server.address().port));
function close(){server.close(async()=>{db?.close();if(process.env.MONGODB_URI){const {closeMongo}=await import('./mongo-storage.js');await closeMongo();}process.exit(0);});setTimeout(()=>server.closeAllConnections(),10000).unref();}
process.on('SIGTERM',close);process.on('SIGINT',close);
