import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/gallery-download-quota-stream.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,ReadableStream,setTimeout,clearTimeout,console});
const {recordAfterZipCompletion}=exports;
const zip={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/zip.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:zip,ReadableStream,TextEncoder,Uint8Array,ArrayBuffer,Buffer});
const encode=value=>new TextEncoder().encode(value);
function source(chunks){return new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(encode(chunk));controller.close();}});}

test('ZIP end record waits for durable completion; failed completion exposes no valid end record',async()=>{
  let complete,started;const gate=new Promise(resolve=>complete=resolve),begin=new Promise(resolve=>started=resolve);
  let aborted=0;
  const reader=recordAfterZipCompletion(source(['header','photo','END']),async()=>{started();await gate;},async()=>{aborted++;}).getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value),'header');assert.equal(new TextDecoder().decode((await reader.read()).value),'photo');
  let settled=false;const last=reader.read().then(result=>{settled=true;return result;});await begin;await new Promise(resolve=>setTimeout(resolve,10));assert.equal(settled,false);
  complete();assert.equal(new TextDecoder().decode((await last).value),'END');assert.equal((await reader.read()).done,true);assert.equal(aborted,0);
  const failure=recordAfterZipCompletion(source(['header','photo','END']),async()=>{throw Error('database unavailable');},async()=>{aborted++;}).getReader();
  assert.equal(new TextDecoder().decode((await failure.read()).value),'header');assert.equal(new TextDecoder().decode((await failure.read()).value),'photo');
  await assert.rejects(failure.read(),/database unavailable/);assert.equal(aborted,1);
});

test('bounded stalled ZIP cancels its source before releasing the hold',async()=>{
  const events=[];const stalled=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){events.push('source cancelled');}});
  const reader=recordAfterZipCompletion(stalled,async()=>events.push('completed'),async()=>events.push('released'),20).getReader();
  await assert.rejects(reader.read(),/timed out/);assert.deepEqual(events,['source cancelled','released']);
});

test('consumer cancellation releases once and cannot later complete',async()=>{
  const events=[];const reader=recordAfterZipCompletion(source(['header','photo','END']),async()=>events.push('completed'),async()=>events.push('released')).getReader();
  await reader.read();await reader.cancel();assert.deepEqual(events,['released']);
});

test('actual ZIP generator stalled inside an original body cannot delay the outward deadline or quota release',async()=>{
  let released=0,aborted=0;
  const body=new ReadableStream({pull(){return new Promise(()=>{});}});
  async function* entries(){yield {name:'original.jpg',stream:body};}
  const reader=recordAfterZipCompletion(zip.createZipStream(entries()),async()=>assert.fail('Stalled archive cannot complete'),async()=>{released++;},20,()=>{aborted++;}).getReader();
  const outcome=await Promise.race([reader.read().then(()=> 'unexpected success',()=> 'rejected'),new Promise(resolve=>setTimeout(()=>resolve('still pending'),150))]);
  assert.equal(outcome,'rejected');assert.equal(released,1);assert.equal(aborted,1);
});
