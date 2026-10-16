import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

test('the serverless helper download embeds the exact verified archive and every shipped script matches its source',()=>{
 const generated=read('lib/labs/connector-package.ts').toString(),archive=read('public/downloads/studio-os-lab-helper-windows.zip');
 const encoded=/LAB_CONNECTOR_PACKAGE_BASE64 = ("[^"]+")/.exec(generated),fingerprint=/LAB_CONNECTOR_PACKAGE_SHA256 = "([a-f0-9]{64})"/.exec(generated);
 assert(encoded&&fingerprint);assert.deepEqual(Buffer.from(JSON.parse(encoded[1]),'base64'),archive);assert.equal(hash(archive),fingerprint[1]);
 assert.equal(read('public/downloads/studio-os-lab-helper-windows.zip.sha256').toString().split(' ')[0],fingerprint[1]);
 const entries=new Map();let offset=0;
 while(archive.readUInt32LE(offset)===0x04034b50){
  const flags=archive.readUInt16LE(offset+6),method=archive.readUInt16LE(offset+8),compressedSize=archive.readUInt32LE(offset+18),size=archive.readUInt32LE(offset+22),nameLength=archive.readUInt16LE(offset+26),extraLength=archive.readUInt16LE(offset+28);
  assert.equal(flags&9,0,'No encryption or streaming descriptor may hide an unchecked entry');
  const name=archive.subarray(offset+30,offset+30+nameLength).toString();assert(!entries.has(name));
  const start=offset+30+nameLength+extraLength,compressed=archive.subarray(start,start+compressedSize);
  assert([0,8].includes(method));const bytes=method===8?inflateRawSync(compressed):compressed;assert.equal(bytes.length,size);entries.set(name,bytes);offset=start+compressedSize;
 }
 const names=['StudioOsLab.Core.ps1','StudioOsLab.ps1','Start-Studio-OS-Lab.cmd','Read me first.txt'];
 assert.deepEqual([...entries.keys()],[...names,'SHA256SUMS.txt']);
 for(const name of names){assert.deepEqual(entries.get(name),read('tools/lab-connector/'+name));assert(entries.get('SHA256SUMS.txt').toString().includes(hash(entries.get(name))+'  '+name));}
 const route=read('app/labs-pilot/connector-download/route.ts').toString();assert(route.includes('LAB_CONNECTOR_PACKAGE_BASE64'));assert(!route.includes('readFile'),'A deployed download cannot depend on an untraced archive path');
});
