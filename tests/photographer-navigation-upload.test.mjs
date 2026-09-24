import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path){const exports={};const compiled=ts.transpileModule(readFileSync(new URL('../'+path+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',compiled)(name=>{assert.ok(['./r2-access-security','./agreement'].includes(name));return load('lib/'+name.slice(2))},exports);return exports;}
const {resolveSignInRedirect}=load('lib/sign-in-redirect');
const {assertKeyOwnedByPhotographer}=load('lib/upload-ownership');
test('sign-in preserves download next, explicit redirect and dashboard fallback',()=>{
 assert.equal(resolveSignInRedirect('?next=%2Fapi%2Fstudio-os-app%2Fdownload%3Fplatform%3Dmac'),'/api/studio-os-app/download?platform=mac');
 assert.equal(resolveSignInRedirect('?redirect=%2Fdashboard%2Fmembership&next=%2Fother'),'/dashboard/membership');
 assert.equal(resolveSignInRedirect(''),'/dashboard');
});
test('sign-in rejects off-site, script, malformed and backslash destinations',()=>{
 for(const value of ['https://other.test','//other.test','javascript:alert(1)','/\\other.test','/\n/other.test',' /dashboard'])assert.equal(resolveSignInRedirect('?next='+encodeURIComponent(value)),'/dashboard');
});
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',schoolId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function database(rows,{fail=false}={}){
 const queries=[];
 return {queries,from(table){const filters=[];queries.push({table,filters});const q={select(){return q},eq(k,v){filters.push([k,v]);return q},limit(){return q},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};
 async function run(single){if(fail)return {data:null,error:new Error('temporary database failure')};
 for(const [k,v] of filters)if(k==='id'&&!/^[0-9a-f-]{36}$/.test(v))throw Error('UUID cast failed');
 const data=rows.filter(row=>filters.every(([k,v])=>row[k]===v));return {data:single?data[0]??null:data,error:null};}
 return q}};
}
test('school uploads accept web and desktop local IDs without UUID cast; prefixed paths also work',async()=>{
 for(const local of ['web_12345','school-local-123'])for(const prefix of ['', 'schools/','photos/','nobg-photos/','nobg-photos/schools/']){
 const db=database([{id:schoolId,local_school_id:local,photographer_id:owner}]);assert.equal((await assertKeyOwnedByPhotographer(db,owner,prefix+local+'/test.jpg')).ok,true);
 assert.ok(db.queries.every(q=>q.filters.every(([k])=>k!=='id')));
 }
 assert.equal((await assertKeyOwnedByPhotographer(database([{id:schoolId,local_school_id:'local',photographer_id:owner}]),owner,schoolId+'/test.jpg')).ok,true);
});
test('upload paths fail closed for foreign or ambiguous schools, traversal and filter injection',async()=>{
 const foreign={id:schoolId,local_school_id:'local',photographer_id:'other'};
 const owned={...foreign,id:owner,photographer_id:owner};
 for(const rows of [[foreign],[foreign,owned],[]])assert.equal((await assertKeyOwnedByPhotographer(database(rows),owner,'local/test.jpg')).ok,false);
 for(const key of ['../local/test.jpg','/local/test.jpg','local//test.jpg','local,id.eq.any/test.jpg'])assert.equal((await assertKeyOwnedByPhotographer(database([owned]),owner,key)).ok,false);
});
test('upload checks distinguish unavailable database from denied ownership; project and backdrop ownership still enforced',async()=>{
 await assert.rejects(()=>assertKeyOwnedByPhotographer(database([],{fail:true}),owner,'local/test.jpg'),/temporary database failure/);
 const db=database([{id:schoolId,photographer_id:owner}]);assert.equal((await assertKeyOwnedByPhotographer(db,owner,'projects/'+schoolId+'/photo.jpg')).ok,true);
 assert.equal((await assertKeyOwnedByPhotographer(db,'other','projects/'+schoolId+'/photo.jpg')).ok,false);
 assert.equal((await assertKeyOwnedByPhotographer(db,owner,'backdrops/'+owner+'/photo.jpg')).ok,true);
 assert.equal((await assertKeyOwnedByPhotographer(db,owner,'backdrops/other/photo.jpg')).ok,false);
});

const {loadAgreementStatus}=load('lib/agreement-status');
test('temporary agreement failures allow retry instead of asking for legal acceptance again',async()=>{
 for(const [payload,state] of [[{authenticated:true,accepted:true},'ok'],[{authenticated:true,accepted:false},'required'],[{authenticated:false,accepted:false},'no-session']])assert.equal(await loadAgreementStatus(async()=>Response.json(payload)),state);
 await assert.rejects(()=>loadAgreementStatus(async()=>Response.json({}, {status:503})),/unavailable/);
 await assert.rejects(()=>loadAgreementStatus(async()=>Response.json({})),/Invalid/);
 await assert.rejects(()=>loadAgreementStatus(async()=>{throw Error('offline')}),/offline/);
});

const {buildAdminTrialChange}=load('lib/admin-trial-change');
test('admin can end a free trial using valid status and extend it from now or the later expiry',()=>{
 const now=Date.parse('2026-09-24T17:00:00Z');const free={subscription_status:'trial'};
 const revoked=buildAdminTrialChange(free,'revoke_trial',0,now);assert.equal(revoked.subscription_status,'trial');assert.equal(Date.parse(revoked.trial_ends_at),now);
 assert.equal(Date.parse(buildAdminTrialChange(free,'extend_trial',30,now).trial_ends_at),now+30*86400000);
 assert.equal(Date.parse(buildAdminTrialChange({...free,trial_ends_at:new Date(now+86400000).toISOString()},'extend_trial',30,now).trial_ends_at),now+31*86400000);
});
test('admin trial actions cannot change owners or paid, Stripe trialing or canceled billing subscriptions',()=>{
 for(const account of [{subscription_status:'trial',is_platform_admin:true},{subscription_status:'active'},{subscription_status:'trialing'},{subscription_status:'canceled',stripe_subscription_id:'sub_existing'}])for(const action of ['extend_trial','revoke_trial'])assert.throws(()=>buildAdminTrialChange(account,action),/free trial accounts/);
});

const {guardAgreement}=load('lib/require-agreement');
test('server agreement gate keeps writes closed while separating unavailable database from missing acceptance',async()=>{
 for(const [result,status] of [[{data:null,error:new Error('offline')},503],[{data:null,error:null},403],[{data:{id:'accepted'},error:null},200]]){
 const query={select(){return query},eq(){return query},limit(){return query},maybeSingle:async()=>result};
 const response=await guardAgreement({service:{from:()=>query},userId:owner});assert.equal(response.ok?200:response.status,status);
 }
});

const {formatCalendarDate}=load('lib/calendar-dates');
test('shoot calendar dates retain their day across photographer time zones and daylight-saving changes',()=>{
 const original=process.env.TZ;
 try{for(const zone of ['America/Toronto','America/Los_Angeles','Australia/Sydney','Pacific/Honolulu']){
  process.env.TZ=zone;
  assert.equal(formatCalendarDate('2026-09-24'),'Sep 24, 2026');
  assert.equal(formatCalendarDate('2026-09-24T00:00:00Z'),'Sep 24, 2026');
  assert.equal(formatCalendarDate('2026-03-08'),'Mar 8, 2026');
  assert.equal(formatCalendarDate('2026-11-01'),'Nov 1, 2026');
 }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
 assert.equal(formatCalendarDate('2026-02-31'),'No date set');assert.equal(formatCalendarDate(null),'No date set');
});
