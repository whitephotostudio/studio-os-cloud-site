import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const output=ts.transpileModule(readFileSync(new URL('../lib/resend.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const resend={};new Function('exports',output)(resend);
const inputs=[{to:'one@example.com',subject:' Reminder ',html:'<p>Ready</p>',fromName:'Studio',replyTo:'reply@example.com'},
  {to:'two@example.com',subject:'Reminder',html:'<p>Ready</p>',tags:[{name:'type',value:'mass-promo'}]}];

function configure(t){const previous=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='fixture-only-api-key';t.after(()=>{if(previous===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previous;});}

test('batch transport keeps one private To address per message and confirms every provider ID in order',async t=>{
  configure(t);let observed;
  t.mock.method(globalThis,'fetch',async(url,options)=>{observed={url,options};return Response.json({data:[{id:'provider-one'},{id:'provider-two'}]});});
  const results=await resend.sendResendEmailBatch(inputs,{idempotencyKey:'fixture-batch-key'});
  assert.deepEqual(results,[{id:'provider-one'},{id:'provider-two'}]);
  assert.equal(observed.url,'https://api.resend.com/emails/batch');assert.equal(observed.options.headers['Idempotency-Key'],'fixture-batch-key');
  const messages=JSON.parse(observed.options.body);assert.deepEqual(messages.map(row=>row.to),[['one@example.com'],['two@example.com']]);
  assert.equal(messages[0].reply_to,'reply@example.com');assert.equal(messages[0].subject,'Reminder');assert.equal(observed.options.cache,'no-store');assert.ok(observed.options.signal instanceof AbortSignal);
});

test('batch transport surfaces the provider quota code and full Retry-After for the caller',async t=>{
  configure(t);t.mock.method(globalThis,'fetch',async()=>Response.json({name:'daily_quota_exceeded',message:'Daily quota exceeded.'},{status:429,headers:{'retry-after':'60'}}));
  await assert.rejects(resend.sendResendEmailBatch(inputs,{idempotencyKey:'fixture-batch-key'}),error=>{
    assert.ok(error instanceof resend.ResendRequestError);assert.equal(error.status,429);assert.equal(error.code,'daily_quota_exceeded');assert.equal(error.retryAfterMs,60000);assert.equal(error.message,'Daily quota exceeded.');return true;
  });
});

test('malformed success cannot be counted as an accepted batch',async t=>{
  configure(t);t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{id:'provider-one'}]}));
  await assert.rejects(resend.sendResendEmailBatch(inputs,{idempotencyKey:'fixture-batch-key'}),/incomplete batch result/);
});

test('provider batch size and unsupported attachments are rejected before any network request',async t=>{
  configure(t);const fetchMock=t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected network request');});
  await assert.rejects(resend.sendResendEmailBatch(Array.from({length:101},()=>inputs[0]),{idempotencyKey:'fixture-batch-key'}),/between 1 and 100/);
  await assert.rejects(resend.sendResendEmailBatch([{...inputs[0],attachments:[{filename:'photo.jpg',content:'fixture'}]}],{idempotencyKey:'fixture-batch-key'}),/does not support attachments/);
  await assert.rejects(resend.sendResendEmailBatch(inputs,{idempotencyKey:''}),/requires an idempotency key/);
  assert.equal(fetchMock.mock.callCount(),0);
});
