import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:') || ['zod','react','react/jsx-runtime'].includes(name)) return require(name);
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, dependencies);
    throw Error(name);
  }, exports);
  return exports;
}
const filters = load('lib/school-visitor-filters.ts');
const audience = load('lib/school-visitor-audience.ts');
const schoolId = '11111111-1111-4111-8111-111111111111';
const photographerId = '22222222-2222-4222-8222-222222222222';
const defaults = filters.DEFAULT_SCHOOL_VISITOR_FILTERS;
const empty = () => ({ visitors: [], registrations: [], orders: [], students: [], contacts: [], downloads: [], favorites: [] });
function example() {
  return { ...empty(),
    visitors: [{id:'v1',viewer_email:' PARENT@example.com ',created_at:'2026-10-01',last_opened_at:'2026-10-07'}],
    registrations: [{id:'r1',email:'parent@example.com',created_at:'2026-10-01',class_names:['Grade 7','Grade 12']}, {id:'r2',email:'OTHER@example.com',class_names:['Grade 7']}],
    students: [{id:'s1',first_name:'Child',last_name:'One',class_name:'Grade 7'}, {id:'s2',first_name:'Child',last_name:'Two',class_name:'Grade 12'}],
    contacts: [{student_id:'s1',email:'parent@example.com'}, {student_id:'s2',email:'PARENT@example.com'}],
  };
}
function order(values = {}) { return { id:'o1',parent_email:'parent@example.com',status:'paid',payment_status:'succeeded',paid_at:'2026-10-07',total_cents:2000,package_name:'Digital - All Photos', ...values }; }

test('saved sibling class choices stay visible after registration and PIN access, even without orders', () => {
  const rows = audience.buildSchoolVisitorAudience(example());
  assert.equal(rows.length, 2);
  const parent = rows.find(row => row.id === 'v1');
  assert.equal(parent.email, 'parent@example.com'); assert.equal(parent.alsoPreRelease, true);
  assert.deepEqual(parent.classNames, ['Grade 7','Grade 12']); assert.deepEqual(parent.studentNames, ['Child One','Child Two']);
  assert.equal(filters.matchesSchoolVisitorFilters(parent, {...defaults,className:'Grade 12',orders:'no_orders',activity:'registered'}), true);
  assert.equal(filters.matchesSchoolVisitorFilters(parent, {...defaults,search:'Child Two'}), true);
  assert.equal(filters.matchesSchoolVisitorFilters(parent, {...defaults,className:'Grade 8'}), false);
});

test('registered parents who have already bought are enriched, never treated as no-order contacts', () => {
  const data = example(); data.visitors = []; data.orders = [order()];
  const parent = audience.buildSchoolVisitorAudience(data).find(row => row.email === 'parent@example.com');
  assert.equal(parent.preRelease, true); assert.equal(parent.orderCount, 1); assert.equal(parent.hasDigitalPurchase, true);
  assert.equal(filters.matchesSchoolVisitorFilters(parent, {...defaults,orders:'no_orders'}), false);
  assert.equal(filters.matchesSchoolVisitorFilters(parent, {...defaults,orders:'digitals'}), true);
});

test('unpaid, print, free downloads, refunds and retouching do not inflate digital buyers', () => {
  for (const purchase of [order({payment_status:'pending',status:'payment_pending',paid_at:null}),
    order({package_name:'8x10 Lustre',items:[{product_name:'8x10 Print',sku:'portrait.jpg'}]}),
    order({refund_status:'refunded',refund_amount_cents:2000}), order({package_name:'Digital Retouching'}), order({total_cents:0})]) {
    const data = example(); data.orders = [purchase];
    assert.equal(audience.buildSchoolVisitorAudience(data)[0].hasDigitalPurchase, false);
  }
  const data = example(); data.downloads = [{viewer_email:'parent@example.com',download_count:4}];
  const parent = audience.buildSchoolVisitorAudience(data).find(row => row.id === 'v1');
  assert.equal(parent.hasDigitalPurchase, false); assert.equal(parent.downloadCount,4);
  assert.equal(filters.matchesSchoolVisitorFilters(parent,{...defaults,activity:'downloads'}), true);
});

test('unpaid and cancelled orders are separate from no orders; paid siblings exclude the whole contact from unpaid', () => {
  const data=example(); data.orders=[order({status:'payment_pending',payment_status:'pending',paid_at:null})];
  let parent=audience.buildSchoolVisitorAudience(data).find(row=>row.id==='v1');
  assert.equal(filters.matchesSchoolVisitorFilters(parent,{...defaults,orders:'no_orders'}),false);
  assert.equal(filters.matchesSchoolVisitorFilters(parent,{...defaults,orders:'unpaid'}),true);
  data.orders.push(order({id:'o2'}));
  parent=audience.buildSchoolVisitorAudience(data).find(row=>row.id==='v1');
  assert.equal(filters.matchesSchoolVisitorFilters(parent,{...defaults,orders:'unpaid'}),false);
  assert.equal(filters.matchesSchoolVisitorFilters(parent,{...defaults,orders:'paid'}),true);
  data.orders=[order({status:'cancelled',payment_status:'cancelled',paid_at:null})];
  parent=audience.buildSchoolVisitorAudience(data).find(row=>row.id==='v1');
  assert.equal(filters.matchesSchoolVisitorFilters(parent,{...defaults,orders:'no_orders'}),false);
});

function database(tables, failures={}) {
  const reads=[];
  return { reads, failures, from(table) {
    let start=0, end=Infinity, mutation=null; const conditions=[], prefixes=[];
    const matches=row=>conditions.every(([key,value])=>row[key]===value)&&prefixes.every(([key,value])=>String(row[key]).startsWith(value));
    const query={select(){return query;},eq(key,value){conditions.push([key,value]);return query;},like(key,value){prefixes.push([key,value.replace(/%$/,'')]);return query;},order(){return query;},range(a,b){start=a;end=b;return run(false);},maybeSingle(){return run(true);},
      upsert(rows,options){mutation={kind:'upsert',rows:Array.isArray(rows)?rows:[rows],options};return query;},
      update(values){mutation={kind:'update',values};return query;},then(resolve,reject){return run(false).then(resolve,reject);}};
    async function run(single){reads.push({table,start,end,school:conditions.find(([key])=>key==='school_id')?.[1]});if(table===failures.failTable&&(failures.failOffset==null||failures.failOffset<0||start===failures.failOffset))return{data:null,error:{code:'XX000'}};
      if(mutation){tables[table]??=[];const inserted=[];if(mutation.kind===failures.failMutation)return{data:null,error:{code:'XX000'}};if(mutation.kind==='update')for(const row of tables[table].filter(matches))Object.assign(row,structuredClone(mutation.values));
        else for(const value of mutation.rows){const prior=tables[table].find(row=>row.dedupe_key===value.dedupe_key);if(prior){if(!mutation.options?.ignoreDuplicates)Object.assign(prior,structuredClone(value));}else{const added={created_at:new Date().toISOString(),...structuredClone(value)};tables[table].push(added);inserted.push(added);}}
        const affected=mutation.kind==='upsert'?inserted:tables[table].filter(matches);return{data:single?structuredClone(affected[0]??null):null,error:null};}
      const rows=(tables[table]||[]).filter(matches);
      return {data:structuredClone(single?rows[0]??null:rows.slice(start,end+1)),error:null};}
    return query;
  }};
}
function tablesFor(data) {
  return Object.fromEntries(Object.entries({school_gallery_visitors:data.visitors,pre_release_registrations:data.registrations,orders:data.orders,students:data.students,school_student_email_contacts:data.contacts,school_gallery_downloads:data.downloads,school_gallery_favorites:data.favorites})
    .map(([table,rows])=>[table,rows.map(row=>({...row,school_id:schoolId}))]));
}

test('all 718 registrations and more than 1000 orders are read; failures cannot masquerade as no orders', async()=>{
  const data=empty(); data.registrations=Array.from({length:718},(_,i)=>({id:`r${i}`,email:`p${i}@example.com`,class_names:['Grade 7']}));
  data.orders=Array.from({length:1101},(_,i)=>order({id:`o${i}`,parent_email:i===1100?'p717@example.com':'buyer@example.com'}));
  const db=database(tablesFor(data)); const loaded=await audience.loadSchoolVisitorData(db,schoolId);
  assert.equal(loaded.registrations.length,718);assert.equal(loaded.orders.length,1101);
  assert.ok(db.reads.some(read=>read.table==='orders'&&read.start===1000));
  const last=audience.buildSchoolVisitorAudience(loaded).find(row=>row.email==='p717@example.com');
  assert.equal(filters.matchesSchoolVisitorFilters(last,{...defaults,orders:'no_orders'}),false);
  await assert.rejects(audience.loadSchoolVisitorData(database(tablesFor(data),{failTable:'orders',failOffset:1000}),schoolId));
});

test('preview fingerprints reject a new order, registration changes, missing contacts and hidden selections',()=>{
  const data=example(); const chosen={...defaults,orders:'no_orders',className:'Grade 12'};
  const reviewed=audience.schoolVisitorEmailAudience(schoolId,data,['v1'],chosen);
  assert.deepEqual(reviewed.recipients,['parent@example.com']);
  data.orders.push(order()); assert.throws(()=>audience.schoolVisitorEmailAudience(schoolId,data,['v1'],chosen));
  data.orders=[]; data.registrations[0].class_names.push('Grade 9');
  assert.notEqual(audience.schoolVisitorEmailAudience(schoolId,data,['v1'],chosen).fingerprint,reviewed.fingerprint);
  assert.throws(()=>audience.schoolVisitorEmailAudience(schoolId,data,['missing'],chosen));
  assert.throws(()=>audience.schoolVisitorEmailAudience(schoolId,data,['pre_r2'],chosen));
});

function emailRouteFixture() {
  const data=example(), tables=tablesFor(data), sent=[], batches=[];
  const resend=load('lib/resend.ts');
  const provider={send:async(inputs,options)=>{batches.push({inputs,options});sent.push(...inputs);return inputs.map((_,index)=>({id:`fixture-${batches.length}-${index}`}));}};
  tables.photographers=[{id:photographerId,user_id:'owner',business_name:'Studio'}]; tables.schools=[{id:schoolId,photographer_id:photographerId}];
  const db=database(tables);
  const route=load('app/api/dashboard/visitors/email/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:'owner'}}),createDashboardServiceClient:()=>db},
    '@/lib/api-validation':{parseJson:async(req,schema)=>{const value=schema.safeParse(await req.json()); return value.success?{ok:true,data:value.data}:{ok:false,response:Response.json({ok:false},{status:400})};}},
    '@/lib/require-agreement':{guardAgreement:async()=>({ok:true})},
    '@/lib/private-media-references':{signedPrivateMediaReference:()=>''},
    '@/lib/resend':{resendConfigured:()=>true,ResendRequestError:resend.ResendRequestError,
      sendResendEmailBatch:(inputs,options)=>provider.send(inputs,options),sendResendEmail:async value=>{sent.push(value);return{id:'fixture-only'};}},
  });
  const schoolAudience={schoolId,visitorIds:['v1'],filters:{...defaults,orders:'no_orders'}};
  const request=body=>({json:async()=>({subject:'Reminder',headline:'Your gallery',message:'Photos are ready',...body})});
  return {route,data,tables,db,sent,batches,provider,ResendRequestError:resend.ResendRequestError,schoolAudience,request};
}

test('email preview is read-only; send resolves the reviewed school scope and ignores arbitrary custom recipients',async()=>{
  const f=emailRouteFixture();const preview=await f.route.POST(f.request({action:'preview',schoolAudience:f.schoolAudience}));
  assert.equal(preview.status,200);assert.equal(f.sent.length,0);const reviewed=(await preview.json()).audience;
  const body={action:'send',recipients:['outside@example.com'],schoolAudience:{...f.schoolAudience,...reviewed,requestId:'33333333-3333-4333-8333-333333333333'}};
  assert.equal((await f.route.POST(f.request(body))).status,200);
  assert.deepEqual(f.sent.map(row=>row.to),['parent@example.com']);assert.ok(f.batches[0].options.idempotencyKey.length<256);
  const replay=await(await f.route.POST(f.request(body))).json();assert.equal(replay.sent,1);assert.equal(f.batches.length,1);
  assert.equal(replay.outcomes[0].providerId,'fixture-1-0');
});

test('new buyers and foreign schools are refused before any provider send',async()=>{
  const f=emailRouteFixture();const reviewed=(await(await f.route.POST(f.request({action:'preview',schoolAudience:f.schoolAudience}))).json()).audience;
  f.tables.orders.push({...order(),school_id:schoolId});
  const response=await f.route.POST(f.request({schoolAudience:{...f.schoolAudience,...reviewed,requestId:'33333333-3333-4333-8333-333333333333'}}));
  assert.equal(response.status,409);assert.equal(f.sent.length,0);
  f.tables.schools[0].photographer_id='foreign';
  assert.equal((await f.route.POST(f.request({action:'preview',schoolAudience:f.schoolAudience}))).status,404);assert.equal(f.sent.length,0);
});

test('report failure during send cannot turn into an empty order list and send a reminder',async()=>{
  const f=emailRouteFixture();const reviewed=(await(await f.route.POST(f.request({action:'preview',schoolAudience:f.schoolAudience}))).json()).audience;
  f.db.failures.failTable='orders';
  const response=await f.route.POST(f.request({schoolAudience:{...f.schoolAudience,...reviewed,requestId:'33333333-3333-4333-8333-333333333333'}}));
  assert.equal(response.status,500); assert.equal(f.sent.length,0);
});

test('class and purchase controls visibly render with counts and independent activity filtering',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const controls=load('components/school-visitor-report-controls.tsx').SchoolVisitorReportControls;
  const html=renderToStaticMarkup(React.createElement(controls,{filters:{...defaults,orders:'no_orders'},onChange(){},classNames:['Grade 7','Grade 12'],counts:{all:2,ordered:1,no_orders:1,paid:1,digitals:1}}));
  assert.match(html,/Filter by class/);assert.match(html,/Grade 12/);assert.match(html,/Purchased digital images/);assert.match(html,/No orders yet/);assert.match(html,/Filter by activity/);
});


test('GET exposes saved registrations, linked student names, and preregistration purchases, with ownership checked first', async()=>{
  const data=example();data.orders=[order()];const tables=tablesFor(data);
  tables.photographers=[{id:photographerId,user_id:'owner'}];tables.schools=[{id:schoolId,school_name:'School',photographer_id:photographerId}];
  const db=database(tables);
  const route=load('app/api/dashboard/schools/[schoolId]/visitors/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:'owner'}}),createDashboardServiceClient:()=>db},
    '@/lib/api-validation':{},'@/lib/audit':{},'@/lib/require-agreement':{},
    '@/lib/storage-images':{buildSignedMediaUrls:()=>({}),publicStorageUrl:()=>'',SIGNED_URL_TTL_DASHBOARD_SECONDS:60},
  });
  const context={params:Promise.resolve({schoolId})};
  const response=await route.GET({},context); assert.equal(response.status,200);
  const result=await response.json(); const parent=result.visitors.find(visitor=>visitor.id==='v1');
  assert.equal(parent.email,'parent@example.com'); assert.equal(parent.firstVisit,'2026-10-01');
  assert.deepEqual(parent.classNames,['Grade 7','Grade 12']);assert.deepEqual(parent.studentNames,['Child One','Child Two']);
  assert.equal(parent.orders.length,1);assert.equal(parent.hasDigitalPurchase,true);
  assert.equal(result.visitors.find(visitor=>visitor.id==='pre_r2').classNames[0],'Grade 7');
  tables.schools[0].photographer_id='foreign'; const before=db.reads.length;
  assert.equal((await route.GET({},context)).status,404);
  assert.equal(db.reads.slice(before).some(read=>read.table==='orders'),false);
});

function visitorBatchFixture(count) {
  const f=emailRouteFixture();
  f.tables.school_gallery_visitors=Array.from({length:count},(_,index)=>({id:`v${index}`,viewer_email:`parent${String(index).padStart(5,'0')}@example.com`,school_id:schoolId}));
  f.tables.pre_release_registrations=[];f.tables.students=[];f.tables.school_student_email_contacts=[];
  f.schoolAudience.visitorIds=f.tables.school_gallery_visitors.map(row=>row.id);
  return f;
}
async function reviewedBatch(f) {
  const response=await f.route.POST(f.request({action:'preview',schoolAudience:f.schoolAudience}));
  assert.equal(response.status,200);
  const preview=await response.json();assert.equal(preview.batchSize,100);
  return {action:'send',schoolAudience:{...f.schoolAudience,...preview.audience,requestId:'33333333-3333-4333-8333-333333333333'}};
}

test('32 recipients use one provider batch; 251 recipients continue without repeating accepted chunks',async()=>{
  const first=visitorBatchFixture(32), body32=await reviewedBatch(first);
  const result32=await(await first.route.POST(first.request(body32))).json();
  assert.equal(result32.sent,32);assert.equal(result32.failed,0);assert.equal(result32.nextOffset,null);
  assert.equal(first.batches.length,1);assert.equal(first.batches[0].inputs.length,32);
  assert.equal(first.batches[0].inputs.every(row=>typeof row.to==='string'),true);
  const f=visitorBatchFixture(251), body=await reviewedBatch(f), outcomes=[];
  let offset=0;
  do{const response=await f.route.POST(f.request({...body,offset}));assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.total,251);assert.equal(result.paused,false);
    outcomes.push(...result.outcomes);offset=result.nextOffset;
  }while(offset!==null);
  assert.deepEqual(f.batches.map(batch=>batch.inputs.length),[100,100,51]);
  assert.equal(new Set(outcomes.map(row=>row.recipientEmail)).size,251);
  const replay=await(await f.route.POST(f.request({...body,offset:100}))).json();
  assert.equal(replay.sent,100);assert.equal(replay.nextOffset,200);assert.equal(f.batches.length,3);
  f.tables.project_email_deliveries.forEach(row=>row.created_at='2020-01-01');
  assert.equal((await(await f.route.POST(f.request({...body,offset:0}))).json()).sent,100);
  assert.equal(f.batches.length,3);
});

test('more than 5000 selected contacts can be reviewed and sent in bounded slices',async()=>{
  const f=visitorBatchFixture(5001), body=await reviewedBatch(f);
  assert.equal(body.schoolAudience.recipients.length,5001);
  const result=await(await f.route.POST(f.request({...body,recipients:body.schoolAudience.recipients}))).json();
  assert.equal(result.total,5001);assert.equal(result.sent,100);assert.equal(result.nextOffset,100);
  assert.equal(f.batches.length,1);
});

test('provider throttling pauses the same chunk with exact failure details and respects Retry-After',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);let attempts=0;
  f.provider.send=async()=>{attempts++;throw new f.ResendRequestError('Please wait for the provider rate window.',429,60_000,'rate_limit_exceeded');};
  const paused=await(await f.route.POST(f.request(body))).json();
  assert.equal(attempts,1);assert.equal(paused.failed,32);assert.equal(paused.pending,0);assert.equal(paused.nextOffset,0);
  assert.equal(paused.paused,true);assert.equal(paused.retryAfterMs,60_000);assert.equal(paused.providerErrorCode,'rate_limit_exceeded');
  assert.equal(paused.outcomes[0].error,'Please wait for the provider rate window.');
  let retriedInputs,retriedKey;
  f.provider.send=async(inputs,options)=>{retriedInputs=inputs;retriedKey=options.idempotencyKey;return inputs.map((_,i)=>({id:`recovered-${i}`}));};
  const recovered=await(await f.route.POST(f.request(body))).json();
  assert.equal(recovered.sent,32);assert.equal(recovered.paused,false);assert.equal(recovered.nextOffset,null);
  assert.equal(retriedInputs.length,32);assert.ok(retriedKey.endsWith(':0'));
});

test('provider quota exhaustion stays visible and does not fan out failures to later chunks',async()=>{
  const f=visitorBatchFixture(251), body=await reviewedBatch(f);let attempts=0;
  f.provider.send=async()=>{attempts++;throw new f.ResendRequestError('Daily email quota exceeded.',429,null,'daily_quota_exceeded');};
  const result=await(await f.route.POST(f.request(body))).json();
  assert.equal(attempts,1);assert.equal(result.failed,100);assert.equal(result.total,251);
  assert.equal(result.paused,true);assert.equal(result.nextOffset,0);assert.equal(result.providerErrorCode,'daily_quota_exceeded');
});

test('unconfirmed old attempts, changed text, and an unavailable ledger never cause another provider send',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);
  f.provider.send=async()=>{throw new f.ResendRequestError('Provider unavailable.',503,60_000);};
  const uncertain=await(await f.route.POST(f.request(body))).json();
  assert.equal(uncertain.pending,32);assert.equal(uncertain.failed,0);
  f.tables.project_email_deliveries.find(row=>row.email_type==='school_visitor_batch').created_at='2020-01-01';
  let sends=0;f.provider.send=async()=>{sends++;return[];};
  const expired=await(await f.route.POST(f.request(body))).json();assert.equal(expired.pending,32);assert.equal(expired.retryAllowed,false);assert.equal(sends,0);
  assert.equal((await f.route.POST(f.request({...body,message:'Different text'}))).status,409);assert.equal(sends,0);
  const unavailable=visitorBatchFixture(1), unavailableBody=await reviewedBatch(unavailable);
  unavailable.db.failures.failTable='project_email_deliveries';
  assert.equal((await unavailable.route.POST(unavailable.request(unavailableBody))).status,500);assert.equal(unavailable.batches.length,0);
});

test('accepted messages pause before the next slice if the durable checkpoint cannot be saved',async()=>{
  const f=visitorBatchFixture(251), body=await reviewedBatch(f);
  f.db.failures.failMutation='update';
  const result=await(await f.route.POST(f.request(body))).json();
  assert.equal(result.sent,100);assert.equal(result.failed,0);assert.equal(result.pending,0);
  assert.equal(result.paused,true);assert.equal(result.nextOffset,0);assert.equal(result.retryAllowed,true);
  assert.match(result.message,/provider accepted/);assert.equal(f.batches.length,1);
  const key=f.batches[0].options.idempotencyKey, inputs=f.batches[0].inputs;
  f.db.failures.failMutation=null;
  f.provider.send=async(retried,options)=>{assert.deepEqual(retried,inputs);assert.equal(options.idempotencyKey,key);return retried.map((_,i)=>({id:`fixture-1-${i}`}));};
  const replay=await(await f.route.POST(f.request(body))).json();assert.equal(replay.sent,100);assert.equal(replay.nextOffset,100);assert.equal(replay.paused,false);
});

test('short provider throttling retries the identical batch with provider pacing',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);const calls=[], waits=[];
  const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(resolve,delay)=>{waits.push(delay);queueMicrotask(resolve);return 0;};
  f.provider.send=async(inputs,options)=>{calls.push({inputs,options});if(calls.length===1)throw new f.ResendRequestError('Too many requests.',429,1250,'rate_limit_exceeded');return inputs.map((_,i)=>({id:`retry-${i}`}));};
  try {
    const result=await(await f.route.POST(f.request(body))).json();assert.equal(result.sent,32);assert.equal(calls.length,2);
    assert.deepEqual(calls[0],calls[1]);assert.deepEqual(waits,[1250]);
  }finally{globalThis.setTimeout=originalTimeout;}
});

test('accepted checkpoints backfill missing recipient history without a provider resend',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);
  const initial=await(await f.route.POST(f.request(body))).json();assert.equal(initial.sent,32);
  f.tables.project_email_deliveries=f.tables.project_email_deliveries.filter(row=>row.email_type!=='mass-promo');
  const replay=await(await f.route.POST(f.request(body))).json();assert.equal(replay.sent,32);assert.equal(f.batches.length,1);
  assert.equal(f.tables.project_email_deliveries.filter(row=>row.email_type==='mass-promo').length,32);
});

test('invalid idempotent payload conflicts require provider review, while concurrent conflicts can retry safely',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);
  f.provider.send=async()=>{throw new f.ResendRequestError('This idempotency key was used with different email data.',409,null,'invalid_idempotent_request');};
  const conflict=await(await f.route.POST(f.request(body))).json();assert.equal(conflict.pending,32);assert.equal(conflict.retryAllowed,false);
  let sends=0;const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=resolve=>{queueMicrotask(resolve);return 0;};
  f.provider.send=async inputs=>{sends++;if(sends===1)throw new f.ResendRequestError('This request is already in progress.',409,null,'concurrent_idempotent_requests');return inputs.map((_,i)=>({id:`recovered-${i}`}));};
  try{const accepted=await(await f.route.POST(f.request(body))).json();assert.equal(accepted.sent,32);assert.equal(sends,2);}finally{globalThis.setTimeout=originalTimeout;}
});

test('a later rejection cannot erase an earlier uncertain provider attempt',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);let sends=0;
  const originalTimeout=globalThis.setTimeout;globalThis.setTimeout=resolve=>{queueMicrotask(resolve);return 0;};
  f.provider.send=async()=>{sends++;if(sends===1)throw new Error('Connection lost before the provider response.');throw new f.ResendRequestError('Daily quota exceeded.',429,null,'daily_quota_exceeded');};
  try{const result=await(await f.route.POST(f.request(body))).json();assert.equal(result.pending,32);assert.equal(result.failed,0);assert.equal(result.paused,true);assert.equal(sends,2);}finally{globalThis.setTimeout=originalTimeout;}
});

test('a malformed saved address fails individually while valid recipients continue in the same batch',async()=>{
  const f=visitorBatchFixture(101);f.tables.school_gallery_visitors[1].viewer_email='bad-address';
  const body=await reviewedBatch(f), result=await(await f.route.POST(f.request(body))).json();
  assert.equal(result.sent,99);assert.equal(result.failed,1);assert.equal(result.pending,0);assert.equal(result.paused,false);assert.equal(result.nextOffset,100);
  assert.equal(f.batches[0].inputs.length,99);assert.equal(f.batches[0].inputs.some(row=>row.to==='bad-address'),false);
  const failed=result.outcomes.find(row=>row.status==='failed');assert.equal(failed.recipientEmail,'bad-address');assert.match(failed.error,/saved email address is invalid/);
  const replay=await(await f.route.POST(f.request(body))).json();assert.equal(replay.sent,99);assert.equal(replay.failed,1);assert.equal(f.batches.length,1);
  const rest=await(await f.route.POST(f.request({...body,offset:100}))).json();assert.equal(rest.sent,1);assert.equal(rest.nextOffset,null);
});

test('an all-invalid slice records failures without making a provider request',async()=>{
  const f=visitorBatchFixture(1);f.tables.school_gallery_visitors[0].viewer_email='bad-address';const body=await reviewedBatch(f);
  const result=await(await f.route.POST(f.request(body))).json();assert.equal(result.sent,0);assert.equal(result.failed,1);assert.equal(result.paused,false);assert.equal(result.nextOffset,null);assert.equal(f.batches.length,0);
});

test('uncertainty survives browser retries: a later 429 cannot mark an earlier unconfirmed batch as failed',async()=>{
  const f=visitorBatchFixture(32), body=await reviewedBatch(f);
  f.provider.send=async()=>{throw new f.ResendRequestError('Provider unavailable.',503,60_000);};
  const first=await(await f.route.POST(f.request(body))).json();assert.equal(first.pending,32);assert.equal(first.failed,0);
  f.provider.send=async()=>{throw new f.ResendRequestError('Rate window exceeded.',429,60_000,'rate_limit_exceeded');};
  const second=await(await f.route.POST(f.request(body))).json();assert.equal(second.pending,32);assert.equal(second.failed,0);assert.equal(second.nextOffset,0);
});

test('read-only recovery confirms accepted recipients after audience changes and refuses uncertain fresh resends',async()=>{
  const f=visitorBatchFixture(101), body=await reviewedBatch(f);
  await f.route.POST(f.request(body));f.tables.orders.push({...order({parent_email:f.tables.school_gallery_visitors[0].viewer_email}),school_id:schoolId});
  const checked=await(await f.route.POST(f.request({...body,action:'status'}))).json();
  assert.equal(checked.ok,true);assert.equal(checked.outcomes.filter(row=>row.status==='sent').length,100);assert.equal(checked.canReviewRemaining,true);assert.equal(f.batches.length,1);
  f.tables.orders=[];f.provider.send=async()=>{throw new f.ResendRequestError('Unconfirmed provider response.',503,60_000);};
  await f.route.POST(f.request({...body,offset:100}));
  const pending=await(await f.route.POST(f.request({...body,action:'status'}))).json();assert.equal(pending.canReviewRemaining,false);assert.equal(pending.uncertainBatches.length,1);assert.equal(pending.uncertainBatches[0].offset,100);
  assert.equal(pending.outcomes.length,100);assert.equal(f.batches.length,1);
  f.tables.schools[0].photographer_id='foreign';assert.equal((await f.route.POST(f.request({...body,action:'status'}))).status,404);
});

test('direct recipient lists retain their previous 5000-address request bound without limiting server-resolved school audiences',async()=>{
  const f=emailRouteFixture(), recipients=Array.from({length:5001},(_,index)=>`direct${index}@example.com`);
  const overLimit=await f.route.POST(f.request({recipients}));assert.equal(overLimit.status,400);assert.equal(f.sent.length,0);assert.equal(f.db.reads.length,0);
  const direct=await f.route.POST(f.request({recipients:recipients.slice(0,5000)}));assert.equal(direct.status,200);assert.equal((await direct.json()).sent,5000);
  assert.equal(f.sent.length,5000);
});
