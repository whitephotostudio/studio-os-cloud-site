import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';

function load(path, overrides={}) {
 const exports={};
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',compiled)(name=>{
  if (name in overrides) return overrides[name];
  if(name.startsWith('@/lib/'))return load(name.slice(2)+'.ts',overrides);
  throw Error('Unexpected dependency '+name);
 },exports);
 return exports;
}

const {buildSignupWelcomeEmail}=load('lib/signup-welcome-email.ts');
test('welcome explains a first gallery, platform availability, import and monitored help without unsafe HTML',()=>{
 const email=buildSignupWelcomeEmail({fullName:'<Miko>',businessName:'A & B <studio>'});
 assert.match(email.text,/Create a gallery/);
 assert.match(email.text,/web dashboard on Mac or Windows/);
 assert.match(email.text,/Windows desktop is coming soon/);
 assert.match(email.text,/Cloud → Import Hub → From Cloud/);
 assert.match(email.text,/hello@studiooscloud.com/);
 assert.match(email.html,/&lt;Miko&gt;/);
 assert.match(email.html,/A &amp; B &lt;studio&gt;/);
 assert.doesNotMatch(email.html,/<Miko>|<studio>/);
 assert.match(email.html,/mailto:hello@studiooscloud.com/);
});

function harness({receipt='provider-message',sentAt=null,ageMs=1000,throws=false}={}){
 const sends=[],updates=[];
 const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid',created_at:new Date(Date.now()-ageMs).toISOString(),user_metadata:sentAt?{studio_os_welcome_email_sent_at:sentAt}:{}};
 const overrides={
  'next/server':{NextResponse:Response},zod:{z},
  '@/lib/dashboard-auth':{createDashboardServiceClient:()=>({auth:{admin:{getUserById:async()=>({data:{user},error:null}),updateUserById:async(_id,value)=>{updates.push(value);return {error:null};}}}})},
  '@/lib/rate-limit':{getClientIp:()=> 'fixture',rateLimit:async()=>({allowed:true})},
  '@/lib/resend':{resendConfigured:()=>true,sendResendEmail:async value=>{sends.push(value);if(throws)throw Error('fixture provider timeout');return {id:receipt};}},
 };
 return {POST:load('app/api/onboarding/welcome/route.ts',overrides).POST,sends,updates,user};
}
const request=user=>new Request('https://example.invalid/api/onboarding/welcome',{method:'POST',body:JSON.stringify({userId:user.id}),headers:{'content-type':'application/json'}});

test('welcome uses bounded delivery and saves only a confirmed receipt',async()=>{
 const f=harness();
 assert.equal((await f.POST(request(f.user))).status,204);
 assert.equal(f.sends.length,1);
 assert.equal(f.sends[0].timeoutMs,10000);
 assert.equal(f.sends[0].replyTo,process.env.WELCOME_REPLY_TO_EMAIL || process.env.SUPPORT_EMAIL || 'hello@studiooscloud.com');
 assert.equal(f.sends[0].idempotencyKey,`studio-os-signup-welcome-${f.user.id}`);
 assert.equal(f.updates[0].user_metadata.studio_os_welcome_email_id,'provider-message');
});

test('welcome does not mark a timeout or missing provider receipt as sent',async()=>{
 for(const options of [{receipt:null},{throws:true}]){
  const f=harness(options);
  assert.equal((await f.POST(request(f.user))).status,204);
  assert.equal(f.sends.length,1);
  assert.equal(f.updates.length,0);
 }
});

test('welcome suppresses duplicate and old-account mail without leaking delivery state',async()=>{
 for(const options of [{sentAt:new Date().toISOString()},{ageMs:2*3600000}]){
  const f=harness(options);
  assert.equal((await f.POST(request(f.user))).status,204);
  assert.equal(f.sends.length,0);
  assert.equal(f.updates.length,0);
 }
});
