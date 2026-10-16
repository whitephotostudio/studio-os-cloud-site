import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const files=['StudioOsLab.Core.ps1','StudioOsLab.ps1','Start-Studio-OS-Lab.cmd','Read me first.txt'];
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'studio-os-lab-zip-'));
try {
 const sums=[];
 for(const name of files){const bytes=await fs.readFile(path.join(root,'tools/lab-connector',name));await fs.writeFile(path.join(temporary,name),bytes);sums.push(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}`);}
 await fs.writeFile(path.join(temporary,'SHA256SUMS.txt'),sums.join('\r\n')+'\r\n');
 const folder=path.join(root,'public/downloads');await fs.mkdir(folder,{recursive:true});
 const output=path.join(folder,'studio-os-lab-helper-windows.zip');await fs.rm(output,{force:true});
 execFileSync('zip',['-X','-q',output,...files,'SHA256SUMS.txt'],{cwd:temporary});
 const digest=crypto.createHash('sha256').update(await fs.readFile(output)).digest('hex');
 await fs.writeFile(output+'.sha256',`${digest}  studio-os-lab-helper-windows.zip\n`);
 console.log(JSON.stringify({output,sha256:digest,contains:files.length+1,testOnly:true,printAllowed:false}));
} finally {await fs.rm(temporary,{recursive:true,force:true});}
