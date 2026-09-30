import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const bytes=Buffer.from([1,2,3]);const hash=createHash('sha256').update(bytes).digest('hex');
function load(path,modules){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>modules[name],exports);return exports;}
test('credit recovery restores saved results and refunds missing outputs without repeating provider calls',async()=>{
  const jobs=[{id:'saved',lease_token:'a',original_sha256:hash,output_sha256:hash,output_key:'saved.png'},{id:'missing',lease_token:'b',output_key:'missing.png'},{id:'storage-error',lease_token:'c',output_key:'error.png'}];
  const results=[];
  const api=load('lib/cloud-credit-recovery.ts',{
    '@aws-sdk/client-s3':{GetObjectCommand:class {constructor(args){this.input=args;}}},
    'node:crypto':{createHash},
    '@/lib/r2':{R2_BUCKET:'fixture',getR2Client:()=>({send:async command=>{
      if(command.input.Key==='missing.png')throw {$metadata:{httpStatusCode:404}};
      if(command.input.Key==='error.png')throw {$metadata:{httpStatusCode:403}};
      return {ContentType:'image/png',ContentLength:bytes.length,Body:{transformToByteArray:async()=>bytes}};
    }})},
  });
  const chain={select:()=>chain,eq:()=>chain,lte:()=>chain,order:()=>chain,limit:async()=>({data:jobs,error:null})};
  const service={from:()=>chain,rpc:async(name,args)=>{assert.equal(name,'finish_cloud_credit_job');results.push(args);return {data:true,error:null};}};
  assert.deepEqual(await api.recoverInterruptedCloudCredits(service),{processed:3,recovered:1,refunded:1,failed:1});
  assert.deepEqual(results.map(r=>[r.p_job_id,r.p_succeeded]).sort((a,b)=>a[0].localeCompare(b[0])),[['missing',false],['saved',true]]);
});
test('credit recovery cron fails closed without the exact scheduler credential',async()=>{
  const old=process.env.CRON_SECRET;
  try {
    const api=load('app/api/cron/credit-processing-recovery/route.ts',{'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>{throw new Error('Must not access database');}},'@/lib/cloud-credit-recovery':{}});
    for(const secret of [undefined,'configured-secret']) {
      if(secret)process.env.CRON_SECRET=secret;else delete process.env.CRON_SECRET;
      assert.equal((await api.GET({headers:new Headers()})).status,401);
      assert.equal((await api.GET({headers:new Headers({authorization:'Bearer wrong'})})).status,401);
    }
  } finally {if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});
