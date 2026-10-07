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
    let school, id, user, start=0, end=Infinity;
    const query={select(){return query;},eq(key,value){ if(key==='school_id')school=value; else if(key==='id')id=value; else if(key==='user_id')user=value; return query; },order(){return query;},range(a,b){start=a;end=b;return run(false);},maybeSingle(){return run(true);}};
    async function run(single){reads.push({table,start,end,school});if(table===failures.failTable&&(failures.failOffset==null||failures.failOffset<0||start===failures.failOffset))return{data:null,error:{code:'XX000'}};
      const rows=(tables[table]||[]).filter(row=>(!school||row.school_id===school)&&(!id||row.id===id)&&(!user||row.user_id===user));
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
  const data=example(), tables=tablesFor(data), sent=[];
  tables.photographers=[{id:photographerId,user_id:'owner',business_name:'Studio'}]; tables.schools=[{id:schoolId,photographer_id:photographerId}];
  const db=database(tables);
  const route=load('app/api/dashboard/visitors/email/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:'owner'}}),createDashboardServiceClient:()=>db},
    '@/lib/api-validation':{parseJson:async(req,schema)=>{const value=schema.safeParse(await req.json()); return value.success?{ok:true,data:value.data}:{ok:false,response:Response.json({ok:false},{status:400})};}},
    '@/lib/require-agreement':{guardAgreement:async()=>({ok:true})},
    '@/lib/private-media-references':{signedPrivateMediaReference:()=>''},
    '@/lib/resend':{resendConfigured:()=>true,sendResendEmail:async value=>{sent.push(value);return{id:'fixture-only'};}},
  });
  const schoolAudience={schoolId,visitorIds:['v1'],filters:{...defaults,orders:'no_orders'}};
  const request=body=>({json:async()=>({subject:'Reminder',headline:'Your gallery',message:'Photos are ready',...body})});
  return {route,data,tables,db,sent,schoolAudience,request};
}

test('email preview is read-only; send resolves the reviewed school scope and ignores arbitrary custom recipients',async()=>{
  const f=emailRouteFixture();const preview=await f.route.POST(f.request({action:'preview',schoolAudience:f.schoolAudience}));
  assert.equal(preview.status,200);assert.equal(f.sent.length,0);const reviewed=(await preview.json()).audience;
  const body={action:'send',recipients:['outside@example.com'],schoolAudience:{...f.schoolAudience,...reviewed,requestId:'33333333-3333-4333-8333-333333333333'}};
  assert.equal((await f.route.POST(f.request(body))).status,200);
  assert.deepEqual(f.sent.map(row=>row.to),['parent@example.com']);assert.ok(f.sent[0].idempotencyKey.length<256);
  assert.equal((await f.route.POST(f.request(body))).status,200);assert.equal(f.sent[1].idempotencyKey,f.sent[0].idempotencyKey);
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
