import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, id } from './helpers/event-gallery-harness.mjs';

const schoolId = id(70), studio = id(71), studentId = id(72), secondId = id(73);
const portrait = `schools/${schoolId}/Seniors/Jane/portrait.jpg`, second = `schools/${schoolId}/Seniors/John/portrait.jpg`;
const route = 'app/api/portal/yearbook/route.ts', ownerRoute = 'app/api/dashboard/schools/[schoolId]/yearbook/route.ts';
function fixture(options = {}) {
  let h;
  h = harness({ folderFiles: [portrait, second, portrait.replace('.jpg','_preview.jpg'), `${portrait}/nested.jpg`].map(key => ({ key, name:key.split('/').pop(), url:`https://fixture.test/${key}` })), rateAllowed: options.rateAllowed ?? true,
    overrides: {
      '@/lib/dashboard-auth': { createDashboardServiceClient: () => h.service, resolveDashboardAuth: async () => ({ user: options.user === false ? null : { id:id(80) }, mfaSatisfied:options.mfa ?? true }) },
      '@/lib/require-agreement': { guardAgreement: async () => ({ok:options.agreement ?? true,status:403}) },
    } });
  h.tables.schools.push({ id:schoolId,photographer_id:studio,school_name:'Fixture Seniors',status:'active',portal_status:'active',expiration_date:null,local_school_id:null });
  h.tables.photographers.push({ id:studio,user_id:id(80),subscription_status:'active' });
  h.tables.students.push({ id:studentId,school_id:schoolId,pin:'12345',first_name:'Jane',last_name:'Student',class_name:'Seniors',folder_name:'Jane',photo_url:portrait },{ id:secondId,school_id:schoolId,pin:'12345',first_name:'John',last_name:'Student',class_name:'Seniors',folder_name:'John',photo_url:second });
  h.tables.school_yearbook_settings=[{school_id:schoolId,enabled:true,deadline:null,revision:1}];
  h.tables.school_yearbook_selections=[];
  h.tables.school_gallery_favorites=[{school_id:schoolId,media_id:second}];
  h.service.rpc = async (name,args) => {
    assert.equal(name,'save_school_yearbook_selection');
    const prior=h.tables.school_yearbook_selections.find(row=>row.student_id===args.p_student_id);
    if((prior?.revision??0)!==args.p_expected_revision)return {data:null,error:{code:'40001'}};
    const value={school_id:args.p_school_id,student_id:args.p_student_id,media_key:args.p_media_key,filename:args.p_filename,source:args.p_source,revision:(prior?.revision??0)+1,updated_at:new Date().toISOString()};
    if(prior)Object.assign(prior,value);else h.tables.school_yearbook_selections.push(value);
    h.writes.push({table:'school_yearbook_selections',value});return {data:value,error:null};
  };
  const payload=(extra={})=>({action:'select',schoolId,pin:'12345',email:'parent@example.test',studentId,mediaKey:portrait,expectedRevision:0,...extra});
  async function owner(method, extra={}) {
    const request=method==='GET'?{nextUrl:new URL(`https://fixture.test/api?${new URLSearchParams(extra)}`),headers:new Headers()}:new Request('https://fixture.test/api',{method,body:JSON.stringify(extra),headers:{'content-type':'application/json'}});
    const result=await h.load(ownerRoute)[method](request,{params:Promise.resolve({schoolId})});
    return {status:result.status,body:result.headers.get('content-type')?.includes('json')?await result.json():await result.text(),headers:result.headers};
  }
  return {...h,payload,owner};
}

test('parent choice survives a fresh server read and never modifies shopping favorites',async()=>{
  const h=fixture(),saved=await h.post(route,h.payload());assert.equal(saved.status,200);assert.equal(saved.body.selection.revision,1);
  const loaded=await h.post(route,h.payload({action:'load'}));assert.equal(loaded.status,200);assert.equal(loaded.body.students[0].selection.media_key,portrait);assert.equal(loaded.body.students[0].selectionAvailable,true);
  assert.equal(loaded.body.students[0].photos.length,1);assert.match(loaded.body.students[0].photos[0].previewUrl,/school-preview/);
  assert.equal(JSON.stringify(loaded.body).includes('https://fixture.test'),false);assert.equal(h.tables.school_gallery_favorites[0].media_id,second);
  assert.ok(h.writes.every(write=>write.table==='school_yearbook_selections'));
});

for (const [name,changes,body,status] of [
  ['wrong PIN',()=>{}, {pin:'00000'},404],
  ['wrong school',()=>{}, {schoolId:id(99)},404],
  ['foreign student',()=>{}, {studentId:id(99)},404],
  ['same family PIN cannot assign sibling photo',()=>{}, {studentId:secondId},404],
  ['derived preview cannot be designated',()=>{}, {mediaKey:portrait.replace('.jpg','_preview.jpg')},400],
  ['nested folder cannot be designated',()=>{}, {mediaKey:`${portrait}/nested.jpg`},404],
  ['object absent from current R2 listing',()=>{}, {mediaKey:portrait.replace('portrait','missing')},404],
  ['closed gallery',h=>h.tables.schools[0].portal_status='closed',{},403],
  ['pre-release gallery',h=>h.tables.schools[0].portal_status='pre_release',{},403],
  ['expired gallery',h=>h.tables.schools[0].expiration_date='2020-01-01',{},403],
  ['inactive subscription',h=>h.tables.photographers[0].subscription_status='cancelled',{},403],
  ['disabled selections',h=>h.tables.school_yearbook_settings[0].enabled=false,{},403],
  ['deadline passed',h=>h.tables.school_yearbook_settings[0].deadline='2020-01-01',{},403],
  ['removed portrait',h=>h.tables.school_photo_deletions.push({school_id:schoolId,storage_family:'Seniors/Jane/portrait',storage_key:portrait}),{},404],
  ['invalid revision',()=>{}, {expectedRevision:-1},400],
]) test(`${name} fails without a write`,async()=>{const h=fixture();changes(h);const result=await h.post(route,h.payload(body));assert.equal(result.status,status);assert.equal(h.writes.length,0);});

test('optimistic revisions reject concurrent stale choices and reload returns winning pose',async()=>{
  const h=fixture();assert.equal((await h.post(route,h.payload())).status,200);assert.equal((await h.post(route,h.payload())).status,409);assert.equal(h.writes.length,1);
  assert.equal((await h.post(route,h.payload({expectedRevision:1}))).status,200);assert.equal(h.tables.school_yearbook_selections[0].revision,2);
});

test('disabled settings stay invisible, while a closed deadline retains the saved choice',async()=>{
  const h=fixture();await h.post(route,h.payload());h.tables.school_yearbook_settings[0].deadline='2020-01-01';
  const closed=await h.post(route,h.payload({action:'load'}));assert.equal(closed.body.open,false);assert.equal(closed.body.students[0].selectionAvailable,true);
  h.tables.school_yearbook_settings[0].enabled=false;const disabled=await h.post(route,h.payload({action:'load'}));assert.equal(disabled.body.students.length,0);
});

test('owner tools require authentication, MFA, school ownership and agreement on writes',async()=>{
  for(const options of [{user:false},{mfa:false}]){const h=fixture(options);assert.ok([401,403].includes((await h.owner('GET')).status));assert.equal(h.writes.length,0);}
  const foreign=fixture();foreign.tables.schools[0].photographer_id=id(99);assert.equal((await foreign.owner('GET')).status,404);
  const agreement=fixture({agreement:false});assert.equal((await agreement.owner('PATCH',{action:'select',studentId,mediaKey:portrait,expectedRevision:0})).status,403);assert.equal(agreement.writes.length,0);
  const h=fixture();h.tables.school_yearbook_settings[0].deadline='2020-01-01';assert.equal((await h.owner('PATCH',{action:'select',studentId,mediaKey:portrait,expectedRevision:0})).status,200);assert.equal(h.writes[0].value.source,'photographer');
});

test('owner export revalidates missing/tombstoned portraits and protects spreadsheet cells',async()=>{
  const h=fixture();await h.post(route,h.payload());h.tables.students[0].first_name='=HYPERLINK("evil")';h.tables.school_photo_deletions.push({school_id:schoolId,storage_family:'Seniors/Jane/portrait',storage_key:portrait});
  const exported=await h.owner('GET',{format:'csv'});assert.equal(exported.status,200);assert.match(exported.body,/'=HYPERLINK/);assert.match(exported.body,/"no"/);
  const zip=await h.owner('GET',{format:'zip'});assert.equal(zip.status,409);assert.equal(h.fetched.length,0);
});

test('PIN probes and writes are rate limited before access/provider reads',async()=>{
  const h=fixture({rateAllowed:false});assert.equal((await h.post(route,h.payload())).status,429);assert.equal(h.queries.length,0);
});

test('deadline validation rejects rollover and allows the entire Eastern deadline day',()=>{
  const helper=fixture().load('lib/school-yearbook.ts');assert.throws(()=>helper.yearbookDeadline('2026-02-30'));assert.throws(()=>helper.yearbookDeadline('bad'));assert.equal(helper.yearbookDeadline('2026-10-08'),'2026-10-08');
  assert.equal(helper.yearbookIsOpen({enabled:true,deadline:'2026-10-08'},new Date('2026-10-09T03:59:59Z')),true);
  assert.equal(helper.yearbookIsOpen({enabled:true,deadline:'2026-10-08'},new Date('2026-10-09T04:00:00Z')),false);
});
