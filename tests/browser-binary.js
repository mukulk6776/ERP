import {existsSync} from 'node:fs';
import {join} from 'node:path';

export function browserBinary(){
 if(process.env.CHROME_BINARY)return process.env.CHROME_BINARY;
 const roots=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean);
 const candidates=roots.flatMap(root=>['Google/Chrome/Application/chrome.exe','Microsoft/Edge/Application/msedge.exe'].map(path=>join(root,path)));
 const found=candidates.find(existsSync);
 if(!found)throw Error('Install Chrome or Edge, or set CHROME_BINARY to a Chromium browser executable.');
 return found;
}
