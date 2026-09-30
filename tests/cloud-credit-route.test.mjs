import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../app/api/credits/background-removal/route.ts', import.meta.url), 'utf8');
const id='11111111-1111-4111-8111-111111111111';
function harness(options={}) {
  const calls=[];
  const rpc=[];
  let providerCalls=0;
  const originalFetch=globalThis.fetch;
  const originalKey=process.env.PHOTOROOM_API_KEY;
  if(options.configured===false)delete process.env.PHOTOROOM_API_KEY;
  else process.env.PHOTOROOM_API_KEY='private-fixture-key';
  const service={
    from:table=>{
      const filters={};
      const chain={select:()=>chain,eq:(key,value)=>{filters[key]=value;return chain;},maybeSingle:async()=>{
        if(table==='photographers')return {data:{id:'profile'},error:null};
        assert.equal(table,'credit_cloud_jobs');assert.equal(filters.studio_id,'studio');
        const data=options.existingJob?{studio_id:'studio',photographer_id:'profile',input_sha256:'a'.repeat(64),output_key:`credits/studio/${id}.png`,
          status:'succeeded',lease_token:'claim',lease_expires_at:new Date(Date.now()-60000).toISOString(),...options.existingJob}:null;
        return {data:data&&data.studio_id===filters.studio_id?data:null,error:null};
      }};return chain;
    },
    async rpc(name,args) {
      rpc.push({name,args});
      if(name==='reserve_cloud_credit_job')return options.reserveError?{error:{message:options.reserveError}}:{data:[{claimed:true,state:'processing',token:'claim',output_key:`credits/studio/${id}.png`,lease_expired:false,...options.job}],error:null};
      return options.finishFails&&args.p_succeeded?{error:{message:'Lost completion'}}:{data:true,error:null};
    },
  };
  const exports={};
  const modules={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    'sharp':{default:()=>({metadata:async()=>({width:calls.length&&options.wrongDimensions?641:640,height:480,format:calls.length?'png':'jpeg',hasAlpha:true}),
      stats:async()=>({channels:[{min:0},{min:0},{min:0},{min:options.opaqueOutput?255:0}]})})},
    '@aws-sdk/client-s3':{HeadObjectCommand:class {constructor(args){this.args=args;}}},
    '@/lib/dashboard-auth':{createDashboardServiceClient:()=>service,resolveDashboardAuth:async()=>({user:options.anonymous?null:{id:'studio'},mfaSatisfied:options.mfa!==false})},
    '@/lib/r2':{hasR2Config:()=>true,R2_BUCKET:'fixture',r2Upload:async(...args)=>{calls.push({upload:args[0]});if(options.uploadFails)throw new Error('Upload failed');},getR2Client:()=>({send:async()=>{if(options.headFails)throw {$metadata:{httpStatusCode:503}};if(options.savedOutput===false)throw {$metadata:{httpStatusCode:404}};return {ContentType:'image/png',ContentLength:100};}})},
    '@/lib/r2-signed-urls':{r2PresignedGetUrl:(key,ttl,permissions)=>{assert.equal(permissions.allowCloudCreditOutput,true);return `https://storage.example.invalid/${key}?signature=fixture`; }},
  };
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:false}}).outputText;
  new Function('require','exports',compiled)(name=>modules[name]||(name==='node:crypto'?{createHash:()=>({update:()=>({digest:()=> 'a'.repeat(64)})}),randomUUID:()=>id}:undefined),exports);
  globalThis.fetch=async(url,init)=>{
    providerCalls++; calls.push({provider:String(url)});
    assert.equal(init.headers['x-api-key'],'private-fixture-key');
    return {ok:!options.providerFails,status:options.providerFails?402:200,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
  };
  const request=(extra={})=>({headers:new Headers(),formData:async()=>{const form=new FormData();form.set('job_id',extra.jobId||id);form.set('image_file',new File([new Uint8Array([1,2,3])],'private-name.jpg',{type:'image/jpeg'}));form.set('studio_id','another-account');return form;},...extra});
  return {api:exports,rpc,calls,request,get providerCalls(){return providerCalls;},cleanup(){globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.PHOTOROOM_API_KEY;else process.env.PHOTOROOM_API_KEY=originalKey;}};
}
async function check(options,run){const h=harness(options);try{await run(h);}finally{h.cleanup();}}
test('cloud rejects anonymous, missing MFA and missing provider before spending credits',async()=>{
  for(const [options,status] of [[{anonymous:true},401],[{mfa:false},403],[{configured:false},503]])await check(options,async h=>{
    assert.equal((await h.api.POST(h.request())).status,status);assert.equal(h.rpc.length,0);assert.equal(h.providerCalls,0);
  });
});
test('cloud validates input and insufficient balance without processing',async()=>{
  await check({},async h=>{assert.equal((await h.api.POST(h.request({jobId:'bad'}))).status,400);assert.equal(h.rpc.length,0);});
  await check({reserveError:'Insufficient credits'},async h=>{assert.equal((await h.api.POST(h.request())).status,402);assert.equal(h.providerCalls,0);});
});
test('cloud binds the reservation to authenticated identity and persists successful output',async()=>check({},async h=>{
  const response=await h.api.POST(h.request());assert.equal(response.status,200);
  assert.equal(h.rpc[0].args.p_studio_id,'studio');assert.equal(h.rpc[0].args.p_input_sha256.length,64);
  assert.equal(h.rpc[1].args.p_succeeded,true);assert.equal(h.providerCalls,1);
  const result=await response.json();assert.equal(result.creditsUsed,4);assert.ok(result.outputUrl.startsWith('https://storage.example.invalid/'));
}));
test('cloud replay and concurrent retries never run the provider a second time',async()=>{
  for(const [state,status] of [['succeeded',200],['processing',409],['failed',422]])await check({job:{claimed:false,state}},async h=>{
    assert.equal((await h.api.POST(h.request())).status,status);assert.equal(h.providerCalls,0);
  });
});
test('expired cloud claim recovers saved output or refunds, without provider redispatch',async()=>{
  for(const exists of [true,false])await check({job:{claimed:false,state:'processing',lease_expired:true},savedOutput:exists},async h=>{
    assert.equal((await h.api.POST(h.request())).status,exists?200:422);
    assert.equal(h.rpc.at(-1).args.p_succeeded,exists);assert.equal(h.providerCalls,0);
  });
});
test('provider or storage failure refunds the reserved operation; saved result survives lost DB completion',async()=>{
  for(const options of [{providerFails:true},{uploadFails:true,savedOutput:false}])await check(options,async h=>{
    const response=await h.api.POST(h.request());assert.equal(response.status,422);assert.equal(h.rpc.at(-1).args.p_succeeded,false);
    assert.ok(!(await response.text()).includes('private-fixture-key'));
  });
  await check({finishFails:true},async h=>{assert.equal((await h.api.POST(h.request())).status,503);assert.equal(h.rpc.filter(c=>c.args.p_succeeded===false).length,0);});
});

test('saved cloud outputs survive provider-key removal without reserving credits or exposing another user',async()=>{
  await check({configured:false,existingJob:{}},async h=>{
    assert.equal((await h.api.POST(h.request())).status,200);assert.equal(h.rpc.length,0);assert.equal(h.providerCalls,0);
  });
  await check({configured:false,existingJob:{studio_id:'another-account'}},async h=>{
    const response=await h.api.POST(h.request());assert.equal(response.status,503);assert.equal(h.rpc.length,0);
    assert.ok(!(await response.text()).includes('signature='));
  });
  await check({configured:false,existingJob:{input_sha256:'b'.repeat(64)}},async h=>{
    assert.equal((await h.api.POST(h.request())).status,409);assert.equal(h.rpc.length,0);
  });
});

test('lost successful upload acknowledgement recovers saved output; uncertain HEAD keeps reservation replayable',async()=>{
  await check({uploadFails:true,savedOutput:true},async h=>{
    assert.equal((await h.api.POST(h.request())).status,200);
    assert.equal(h.rpc.at(-1).args.p_succeeded,true);assert.equal(h.providerCalls,1);
    assert.equal(h.rpc.filter(call=>call.args.p_succeeded===false).length,0);
  });
  await check({uploadFails:true,headFails:true},async h=>{
    assert.equal((await h.api.POST(h.request())).status,503);
    assert.equal(h.rpc.filter(call=>call.name==='finish_cloud_credit_job').length,0);
  });
});

test('opaque provider output or changed dimensions refunds instead of selling an unusable result',async()=>{
  for(const options of [{opaqueOutput:true},{wrongDimensions:true}])await check(options,async h=>{
    assert.equal((await h.api.POST(h.request())).status,422);assert.equal(h.rpc.at(-1).args.p_succeeded,false);
    assert.equal(h.calls.filter(call=>call.upload).length,0);
  });
});
