import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {createBackupDownloadTransport,encryptPhotoResponse,verifyEncryptedPhoto,sealManifest,downloadBackup} from '../../scripts/security-photo-backup.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
async function directory(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-backup-transport-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function server(t,handler,tls){
 const instance=tls?https.createServer(tls,handler):http.createServer(handler);
 instance.listen(0,'127.0.0.1');await once(instance,'listening');
 t.after(()=>new Promise(resolve=>{instance.closeAllConnections();instance.close(resolve);}));
 return {instance,origin:`${tls?'https':'http'}://127.0.0.1:${instance.address().port}`};
}
function transport(t,options={}){const client=createBackupDownloadTransport(options);t.after(()=>client.close());return client;}
async function certificate(t,root){
 const key=path.join(root,'tls.key'),cert=path.join(root,'tls.pem');
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-days','1'],{stdio:'ignore'});
 if(result.error?.code==='ENOENT'){t.skip('OpenSSL is required only for the local HTTPS certificate fixture');return null;}
 assert.equal(result.status,0);return {key:await fs.readFile(key),cert:await fs.readFile(cert)};
}

test('Node HTTPS streams through the actual hash/GCM pipeline with exact source headers and TLS verification',async t=>{
 const root=await directory(t),tls=await certificate(t,root);if(!tls)return;
 const source=Buffer.from('synthetic-private-photo-pixels'.repeat(12000));let requests=0;
 const fixture=await server(t,(req,res)=>{requests++;assert.equal(req.method,'GET');assert.equal(req.headers['if-match'],'"stored-etag"');assert.equal(req.headers['accept-encoding'],'identity');res.writeHead(200,{'content-length':source.length,etag:'"stored-etag"','content-type':'image/jpeg'});res.end(source);},tls);
 const strict=transport(t);await assert.rejects(strict.fetcher(fixture.origin+'/photo.jpg'),/self.signed|certificate/i);
 const client=transport(t,{concurrency:2,ca:tls.cert});
 const response=await client.fetcher(fixture.origin+'/photo.jpg',{headers:{'If-Match':'"stored-etag"'}});
 assert.equal(response.status,200);assert.equal(response.headers.get('etag'),'"stored-etag"');
 const key=randomBytes(32),aad=Buffer.from('source-bound'),file=path.join(root,'cipher.enc');
 const record=await encryptPhotoResponse(response,file,key,aad,source.length);
 assert.deepEqual(await verifyEncryptedPhoto(file,key,aad,record),{bytes:source.length,sha256:hash(source)});
 assert.equal((await fs.readFile(file)).includes(Buffer.from('synthetic-private-photo-pixels')),false);assert.equal(requests,1);
});

test('bounded keep-alive pool reuses at most its configured sockets across queued downloads',async t=>{
 let active=0,peak=0;const sockets=new Set();
 const fixture=await server(t,(req,res)=>{sockets.add(req.socket);active++;peak=Math.max(peak,active);setTimeout(()=>{res.end('fixture');active--;},20);});
 const client=transport(t,{concurrency:2});
 await Promise.all(Array.from({length:12},async()=>{const response=await client.fetcher(fixture.origin+'/photo');assert.equal(await response.text(),'fixture');}));
 assert.equal(peak,2);assert.equal(sockets.size,2);
 client.close();await assert.rejects(client.fetcher(fixture.origin+'/closed'),/BACKUP_TRANSPORT_CLOSED/);
 for(const concurrency of [0,17,1.5,NaN])assert.throws(()=>createBackupDownloadTransport({concurrency}),/INVALID_CONCURRENCY/);
});

test('a second HTTPS provider retires idle foreign sockets without waiting for their keep-alive timeout', {timeout:5000}, async t=>{
 const root=await directory(t),tls=await certificate(t,root);if(!tls)return;
 const sockets=new Set();let active=0,peak=0;
 const handler=(_req,res)=>setTimeout(()=>res.end('provider'),10);
 const first=await server(t,handler,tls),second=await server(t,handler,tls);
 for(const fixture of [first,second]){
  fixture.instance.keepAliveTimeout=10000;
  fixture.instance.on('connection',socket=>{sockets.add(socket);active++;peak=Math.max(peak,active);socket.once('close',()=>active--);});
 }
 const client=transport(t,{concurrency:2,ca:tls.cert});
 await Promise.all(Array.from({length:2},async()=>{const response=await client.fetcher(first.origin);assert.equal(await response.text(),'provider');}));
 assert.equal(sockets.size,2);await delay(10);
 const started=Date.now();
 await Promise.all(Array.from({length:2},async()=>{const response=await client.fetcher(second.origin,{signal:AbortSignal.timeout(1000)});assert.equal(await response.text(),'provider');}));
 assert.ok(Date.now()-started<1000);assert.ok(sockets.size>=3&&sockets.size<=4);assert.ok(peak<=2);
});

test('an active origin releases its socket for a queued provider as soon as its body completes', {timeout:3000}, async t=>{
 let release,secondReads=0;
 const first=await server(t,(_req,res)=>{res.writeHead(200,{'content-length':'5'});res.write('fi');release=()=>res.end('rst');});
 first.instance.keepAliveTimeout=10000;
 const second=await server(t,(_req,res)=>{secondReads++;res.end('second');});
 const client=transport(t,{concurrency:1}),response=await client.fetcher(first.origin),firstBody=response.text();
 const queued=client.fetcher(second.origin,{signal:AbortSignal.timeout(1000)});
 await delay(20);assert.equal(secondReads,0);release();
 assert.equal(await firstBody,'first');assert.equal(await (await queued).text(),'second');assert.equal(secondReads,1);
});

test('abort settles a cross-provider queued request while the only socket is still active', {timeout:3000}, async t=>{
 let release,secondReads=0;
 const first=await server(t,(_req,res)=>{res.writeHead(200,{'content-length':'5'});res.write('fi');release=()=>res.end('rst');});
 const second=await server(t,(_req,res)=>{secondReads++;res.end('second');});
 const client=transport(t,{concurrency:1}),response=await client.fetcher(first.origin),firstBody=response.text();
 const started=Date.now(),abort=new AbortController(),queued=client.fetcher(second.origin,{signal:abort.signal});
 setTimeout(()=>abort.abort(),30);
 await assert.rejects(queued,{name:'AbortError'});assert.ok(Date.now()-started<500);assert.equal(secondReads,0);
 release();assert.equal(await firstBody,'first');
 const next=await client.fetcher(second.origin,{signal:AbortSignal.timeout(1000)});assert.equal(await next.text(),'second');assert.equal(secondReads,1);
});

test('redirects are rejected without fetching their target or retaining a response body',async t=>{
 let targetReads=0;
 const fixture=await server(t,(req,res)=>{if(req.url==='/target'){targetReads++;res.end('forbidden');}else{res.writeHead(302,{location:'/target'});res.end('redirect');}});
 const client=transport(t,{concurrency:1});
 await assert.rejects(client.fetcher(fixture.origin+'/redirect',{redirect:'error'}),/SOURCE_REDIRECT_REJECTED/);
 assert.equal(targetReads,0);
 await assert.rejects(client.fetcher('file:///private/source'),/INVALID_SOURCE_REQUEST/);
 await assert.rejects(client.fetcher(fixture.origin+'/target',{method:'PUT',body:'unsafe'}),/INVALID_SOURCE_REQUEST/);
 assert.equal(targetReads,0);
});

test('abort before headers and abort during a streamed body both reject and free the pool',async t=>{
 let reads=0;const closed=[];
 const fixture=await server(t,(req,res)=>{reads++;res.on('close',()=>closed.push(req.url));res.writeHead(200,{'content-length':'100000'});res.write(Buffer.alloc(1024));});
 const client=transport(t,{concurrency:1}),early=new AbortController();early.abort();
 await assert.rejects(client.fetcher(fixture.origin+'/early',{signal:early.signal}),{name:'AbortError'});assert.equal(reads,0);
 const middle=new AbortController(),response=await client.fetcher(fixture.origin+'/middle',{signal:middle.signal});
 const consume=response.arrayBuffer();middle.abort();await assert.rejects(consume,/abort|premature/i);
 await delay(20);assert.deepEqual(closed,['/middle']);
 const cancelled=await client.fetcher(fixture.origin+'/cancel');await cancelled.body.cancel();
 await delay(20);assert.deepEqual(closed,['/middle','/cancel']);
});

test('truncated HTTP bodies reject inside the caller and the next request still succeeds',async t=>{
 let calls=0;
 const fixture=await server(t,(_req,res)=>{calls++;if(calls<=8){res.writeHead(200,{'content-length':'100'});res.write('short');setImmediate(()=>res.destroy());}else res.end('recovered');});
 const client=transport(t,{concurrency:1});
 for(let i=0;i<8;i++){const response=await client.fetcher(fixture.origin+'/truncated');await assert.rejects(response.arrayBuffer(),/aborted|premature|reset/i);}
 const response=await client.fetcher(fixture.origin+'/complete');assert.equal(await response.text(),'recovered');
});

test('bodyless provider errors remain failures and do not block a bounded retry pool',async t=>{
 const fixture=await server(t,(req,res)=>{if(req.url==='/missing'){res.writeHead(404);res.write('private-provider-diagnostic');}else res.end('valid');});
 const client=transport(t,{concurrency:1}),response=await client.fetcher(fixture.origin+'/missing');
 assert.equal(response.status,404);assert.equal(response.ok,false);assert.equal(response.body,null);
 const next=await client.fetcher(fixture.origin+'/valid');assert.equal(await next.text(),'valid');
});

test('actual HTTPS backup retries a truncated object and resumes verified ciphertext without another network read',async t=>{
 const root=await directory(t),tls=await certificate(t,root);if(!tls)return;
 const source=Buffer.from('synthetic-backed-up-original'.repeat(3000));let reads=0;
 const fixture=await server(t,(req,res)=>{reads++;assert.equal(req.headers['if-match'],'"stable"');res.writeHead(200,{'content-length':source.length,etag:'"stable"'});if(reads===1){res.write(source.subarray(0,20));setImmediate(()=>res.destroy());}else res.end(source);},tls);
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const keyDirectory=path.join(root,'keys'),destination=path.join(root,'backup');await fs.mkdir(keyDirectory,{mode:0o700});
 const privateKeyFile=path.join(keyDirectory,'private.pem'),manifestFile=path.join(root,'manifest.enc');await fs.writeFile(privateKeyFile,keys.privateKey,{mode:0o600});
 const manifest={format:'studio-security-photo-manifest-v1',backupId:'transport_backup_test_20261012',createdAt:new Date().toISOString(),objectCount:1,totalBytes:source.length,objects:[{source:'r2',bucket:'private',key:'synthetic/photo.jpg',size:source.length,etag:'stable',url:fixture.origin+'/photo'}]};
 const sealed=sealManifest(manifest,keys.publicKey);await fs.writeFile(manifestFile,sealed);
 const client=transport(t,{concurrency:1,ca:tls.cert}),options={manifestFile,expectedManifestSha256:hash(sealed),privateKeyFile,keyDirectory,destination,fetcher:client.fetcher,concurrency:1};
 const summary=await downloadBackup(options);assert.equal(summary.ok,true);assert.equal(summary.totalBytes,source.length);assert.equal(summary.restoreSamplesVerified,1);assert.equal(reads,2);
 assert.deepEqual(await downloadBackup(options),summary);assert.equal(reads,2);
 const files=await fs.readdir(path.join(destination,manifest.backupId,'objects'));assert.equal(files.some(name=>name.includes('.partial')),false);
});
