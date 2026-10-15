import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,dependencies={}){const source=ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const exports={};new Function('require','exports',source)(name=>{if(name in dependencies)return dependencies[name];if(name.startsWith('node:')||name==='zod')return require(name);if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`,dependencies);if(name.startsWith('./'))return load(`${path.slice(0,path.lastIndexOf('/')+1)}${name.slice(2)}.ts`,dependencies);throw Error(name);},exports);return exports;}
const calendar=load('lib/school-deadline-reminders.ts',{'@/lib/school-deadline-reminder-photo-classes':{loadSchoolDeadlineReminderPhotoClasses:async()=>new Set()}});
const agreement=load('lib/agreement.ts');
const pgid='22222222-2222-4222-8222-222222222222',schoolid='11111111-1111-4111-8111-111111111111';
const now=new Date('2026-10-18T13:00:00Z');
function database(tables,failures={}){let seq=0;const mutations=[];return{tables,failures,mutations,from(table){const tests=[],orders=[];let start=0,end=Infinity,limit=Infinity,mutation;
  const field=(row,key)=>key.includes('->>')?row[key.split('->>')[0]]?.[key.split('->>')[1]]:row[key];
  const query={select(){return query;},eq(key,value){tests.push(row=>field(row,key)===value);return query;},is(key,value){tests.push(row=>value===null?field(row,key)==null:field(row,key)===value);return query;},
    contains(key,value){tests.push(row=>Object.entries(value).every(([k,v])=>typeof v==='object'?Object.entries(v).every(([a,b])=>row[key]?.[k]?.[a]===b):row[key]?.[k]===v));return query;},
    not(key,op,value){assert.equal(op,'is');tests.push(row=>field(row,key)!==value&&field(row,key)!==undefined);return query;},
    gte(key,value){tests.push(row=>String(field(row,key))>=value);return query;},lte(key,value){tests.push(row=>String(field(row,key))<=value);return query;},in(key,values){tests.push(row=>values.includes(field(row,key)));return query;},
    order(key,options){orders.push([key,options?.ascending!==false]);return query;},range(a,b){start=a;end=b;return run(false);},limit(value){limit=value;return query;},maybeSingle(){return run(true);},
    upsert(rows,options){mutation={kind:'upsert',rows:Array.isArray(rows)?rows:[rows],options};return query;},update(values){mutation={kind:'update',values};return query;},then(resolve,reject){return run(false).then(resolve,reject);}};
  async function run(single){if(table===failures.table)return{data:null,error:{code:failures.code??'XX000'}};tables[table]??=[];const matches=row=>tests.every(fn=>fn(row));let rows=tables[table].filter(matches);
    if(mutation){mutations.push({table,...mutation});if(mutation.kind==='update'){for(const row of rows)Object.assign(row,structuredClone(mutation.values));}
      else{rows=[];for(const value of mutation.rows){const existing=tables[table].find(row=>row.dedupe_key===value.dedupe_key);if(existing){if(!mutation.options?.ignoreDuplicates){Object.assign(existing,structuredClone(value));rows.push(existing);}}else{const row={id:`row-${++seq}`,created_at:new Date(Date.now()+seq).toISOString(),...structuredClone(value)};tables[table].push(row);rows.push(row);}}}
    }else{for(const[key,asc]of orders.reverse())rows.sort((a,b)=>(String(a[key]).localeCompare(String(b[key])))*(asc?1:-1));rows=rows.slice(start,Math.min(end+1,start+limit));}
    return{data:structuredClone(single?rows[0]??null:rows),error:null};}
  return query;}};}
function fixture(count=32){const batches=[],photos={classes:new Set(['Grade 7']),error:null},provider={send:async(inputs,options)=>{batches.push({inputs:structuredClone(inputs),options});return inputs.map((_,i)=>({id:`provider-${batches.length}-${i}`}));}};
  const tables={schools:[{id:schoolid,photographer_id:pgid,school_name:'School',status:'active',order_due_date:'2026-10-19T00:00:00+00:00',gallery_settings:{visitorEmailTemplate:{subject:'Due tomorrow',headline:'Order your photos',message:'Please place your order by tomorrow.'},visitorDeadlineReminder:{enabled:true,timeZone:'America/Toronto',sendHour:9,classMode:'all'}}}],
    photographers:[{id:pgid,user_id:'owner',business_name:'Studio',studio_email:'studio@example.com',is_platform_admin:true}],photographer_agreements:[{id:'accepted',user_id:'owner',agreement_version:agreement.CURRENT_AGREEMENT_VERSION}],
    school_gallery_visitors:Array.from({length:count},(_,i)=>({id:`v${i}`,school_id:schoolid,viewer_email:`parent${String(i).padStart(4,'0')}@example.com`})),pre_release_registrations:[],orders:[],
    students:Array.from({length:count},(_,i)=>({id:`s${i}`,school_id:schoolid,class_name:'Grade 7',parent_email:`parent${String(i).padStart(4,'0')}@example.com`})),school_student_email_contacts:[],school_gallery_downloads:[],school_gallery_favorites:[],crm_contacts:[],crm_email_suppressions:[],project_email_deliveries:[]};
  const db=database(tables);const resend=load('lib/resend.ts');
  const worker=load('lib/school-deadline-reminders.ts',{'@/lib/school-deadline-reminder-photo-classes':{loadSchoolDeadlineReminderPhotoClasses:async()=>{if(photos.error)throw photos.error;return new Set(photos.classes);}},'@/lib/resend':{resendConfigured:()=>true,ResendRequestError:resend.ResendRequestError,sendResendEmailBatch:(inputs,options)=>provider.send(inputs,options)}});
  return{tables,db,worker,batches,provider,photos,ResendRequestError:resend.ResendRequestError};}
const fakeTimers=t=>{t.mock.method(globalThis,'setTimeout',resolve=>{queueMicrotask(resolve);return 0;});};
const customer=f=>f.batches.filter(row=>row.inputs[0]?.tags?.some(tag=>tag.value==='school-deadline-reminder'));
const summaries=f=>f.batches.filter(row=>row.inputs[0]?.tags?.some(tag=>tag.value==='school-deadline-summary'));

test('deadline calendar preserves the saved date and applies the configured local 9 AM including DST',()=>{
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-10-19T00:00:00+00:00','America/Toronto',now).reminderDate,'2026-10-18');
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-10-19','America/Toronto',new Date('2026-10-18T12:59:59Z')).due,false);
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-10-19','America/Toronto',now).due,true);
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-10-19','America/Toronto',new Date('2026-10-19T04:00:00Z')).missed,true);
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-11-02','America/Toronto',new Date('2026-11-01T13:59:00Z')).due,false);
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-11-02','America/Toronto',new Date('2026-11-01T14:00:00Z')).due,true);
  assert.equal(calendar.schoolDeadlineReminderCalendar('2026-02-30','America/Toronto',now),null);
});

test('opt-in reminders send one private batch and one photographer summary, with durable hourly replay',async t=>{fakeTimers(t);const f=fixture();
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});assert.equal(customer(f).length,1);assert.equal(customer(f)[0].inputs.length,32);assert.equal(summaries(f).length,1);
  assert.equal(summaries(f)[0].inputs[0].to,'studio@example.com');assert.match(summaries(f)[0].inputs[0].text,/Accepted by the email provider: 32/);
  const status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid,'2026-10-19');assert.equal(status.accepted,32);assert.equal(status.pending,0);assert.ok(status.completedAt);assert.ok(status.summarySentAt);
  assert.equal(await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid,'2026-10-20'),null);
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T14:00:00Z')});assert.equal(f.batches.length,2);
  assert.match(customer(f)[0].inputs[0].html,/Please place your order by tomorrow/);
});

test('OFF, future deadlines and before-9-AM reminders cannot send',async t=>{fakeTimers(t);for(const alter of [f=>{f.tables.schools[0].gallery_settings.visitorDeadlineReminder.enabled=false;},f=>{f.tables.schools[0].order_due_date='2026-10-25';}]){const f=fixture();alter(f);await f.worker.deliverSchoolDeadlineReminders(f.db,{now});assert.equal(f.batches.length,0);}
  const before=fixture();await before.worker.deliverSchoolDeadlineReminders(before.db,{now:new Date('2026-10-18T12:59:00Z')});assert.equal(before.batches.length,0);
});

test('all existing orders and known suppression are excluded; new orders are rechecked between chunks',async t=>{fakeTimers(t);const f=fixture(251);
  f.tables.orders=[{id:'existing',school_id:schoolid,parent_email:'parent0000@example.com',status:'cancelled',payment_status:'pending'}];
  f.tables.crm_email_suppressions=[{id:'suppressed',photographer_id:pgid,email_normalized:'parent0001@example.com',lifted_at:null,scope:'all'}];
  f.tables.crm_contacts=[{id:'dnc',photographer_id:pgid,email:'parent0002@example.com',do_not_contact:true}];
  const original=f.provider.send;
  f.provider.send=async(inputs,options)=>{const result=await original(inputs,options);if(customer(f).length===1)f.tables.orders.push({id:'later',school_id:schoolid,parent_email:'parent0150@example.com',status:'payment_pending'});return result;};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});
  const addresses=customer(f).flatMap(row=>row.inputs.map(input=>input.to));
  assert.equal(addresses.length,247);for(const email of ['parent0000@example.com','parent0001@example.com','parent0002@example.com','parent0150@example.com'])assert.equal(addresses.includes(email),false);
  const status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);assert.equal(status.accepted,247);assert.equal(status.excluded,3);assert.equal(status.pending,0);assert.equal(summaries(f).length,1);
});

test('concurrent cron invocations share a lease and never duplicate customer or summary messages',async t=>{fakeTimers(t);const f=fixture(32);
  await Promise.all([f.worker.deliverSchoolDeadlineReminders(f.db,{now}),f.worker.deliverSchoolDeadlineReminders(f.db,{now})]);
  assert.equal(customer(f).length,1);assert.equal(summaries(f).length,1);
});

test('future and completed school prefixes do not starve a currently due school',async t=>{fakeTimers(t);const f=fixture(1);
  f.tables.schools.unshift(...Array.from({length:80},(_,i)=>({...structuredClone(f.tables.schools[0]),id:`a-future-${i}`,order_due_date:'2027-01-01'})));
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});assert.equal(customer(f).length,1);
});

test('provider failures stay visible, retry safely during the reminder day, and never late-send on the deadline',async t=>{fakeTimers(t);const f=fixture(32);
  f.provider.send=async()=>{throw new f.ResendRequestError('Provider unavailable.',503,60_000);};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});let status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);assert.equal(status.pending,32);assert.equal(status.accepted,0);
  f.provider.send=async(inputs,options)=>{f.batches.push({inputs,options});return inputs.map((_,i)=>({id:`summary-${i}`}));};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-19T13:00:00Z')});assert.equal(customer(f).length,0);assert.equal(summaries(f).length,1);
  status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);assert.equal(status.pending,32);assert.match(status.message,/window ended/);
});

test('agreement failures, expired galleries and suppression outages fail closed',async t=>{fakeTimers(t);for(const alter of [f=>{f.tables.photographer_agreements=[];},f=>{f.tables.schools[0].expiration_date='2026-10-17';},f=>{f.db.failures.table='crm_email_suppressions';}]){const f=fixture();alter(f);await f.worker.deliverSchoolDeadlineReminders(f.db,{now});assert.equal(customer(f).length,0);const status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);assert.equal(status.pending,32);assert.ok(status.message);}});

test('cron endpoint rejects missing/wrong secrets before any worker work',async()=>{
  let calls=0;const route=load('app/api/cron/school-deadline-reminders/route.ts',{'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>({})},'@/lib/school-deadline-reminders':{deliverSchoolDeadlineReminders:async()=>{calls++;return{};}}});
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='fixture-secret';try{assert.equal((await route.GET({headers:new Headers()})).status,401);assert.equal((await route.GET({headers:new Headers({authorization:'Bearer wrong'})})).status,401);assert.equal(calls,0);assert.equal((await route.GET({headers:new Headers({authorization:'Bearer fixture-secret'})})).status,200);assert.equal(calls,1);}finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});

test('only classes with available gallery photos qualify, and zero photo classes wait for later uploads',async t=>{fakeTimers(t);
  const none=fixture();none.photos.classes.clear();await none.worker.deliverSchoolDeadlineReminders(none.db,{now});
  assert.equal(none.batches.length,0);assert.equal(none.tables.project_email_deliveries.length,0);
  none.photos.classes.add('Grade 7');await none.worker.deliverSchoolDeadlineReminders(none.db,{now:new Date('2026-10-18T14:00:00Z')});assert.equal(customer(none)[0].inputs.length,32);
  const half=fixture(32);half.tables.students.forEach((row,i)=>{if(i>=16)row.class_name='Grade 8';});
  await half.worker.deliverSchoolDeadlineReminders(half.db,{now});assert.equal(customer(half)[0].inputs.length,16);
  assert.equal(customer(half)[0].inputs.some(row=>row.to==='parent0016@example.com'),false);
});

test('photo availability is checked again before every chunk',async t=>{fakeTimers(t);const f=fixture(251),original=f.provider.send;
  f.provider.send=async(inputs,options)=>{const result=await original(inputs,options);if(customer(f).length===1)f.photos.classes.clear();return result;};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});const status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);
  assert.equal(customer(f).length,1);assert.equal(status.accepted,100);assert.equal(status.excluded,151);assert.equal(status.pending,0);
});

test('malformed known addresses remain visible as individual failures without blocking other reminders',async t=>{fakeTimers(t);const f=fixture();
  f.tables.school_gallery_visitors[0].viewer_email='bad-address';f.tables.students[0].parent_email='bad-address';
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});const status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);
  assert.equal(status.accepted,31);assert.equal(status.failed,1);assert.equal(customer(f)[0].inputs.length,31);assert.match(summaries(f)[0].inputs[0].text,/Failed: 1/);
});

test('the deadline line preserves the exact saved message and never appears in the photographer summary',async t=>{fakeTimers(t);const f=fixture(1);f.tables.schools[0].gallery_settings.visitorEmailTemplate.message='Custom parent message\nKeep this exact.';
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});const parent=customer(f)[0].inputs[0],summary=summaries(f)[0].inputs[0];
  assert.match(parent.text,/Orders are due tomorrow \(October 19, 2026\)/);assert.ok(parent.text.includes('Custom parent message\nKeep this exact.'));assert.ok(parent.html.includes('Custom parent message\nKeep this exact.'));
  assert.equal(summary.text.includes('Orders are due tomorrow'),false);
});

test('changing a deadline or disabling a pending run ends its remaining sends and reports the partial result',async t=>{fakeTimers(t);
  for(const alter of [f=>{f.tables.schools[0].order_due_date='2026-11-01';},f=>{f.tables.schools[0].gallery_settings.visitorDeadlineReminder.enabled=false;}]){
    const f=fixture();f.provider.send=async()=>{throw new f.ResendRequestError('Provider unavailable.',503,60_000);};await f.worker.deliverSchoolDeadlineReminders(f.db,{now});alter(f);
    f.provider.send=async(inputs,options)=>{f.batches.push({inputs,options});return inputs.map((_,i)=>({id:`summary-${i}`}));};
    await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T14:00:00Z')});assert.equal(customer(f).length,0);assert.equal(summaries(f).length,1);
    const status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid,'2026-10-19');assert.equal(status.pending,32);assert.match(status.message,/ended/);
  }
});

test('a saved pending run respects a later configured timezone and waits until its local 9 AM',async t=>{fakeTimers(t);const f=fixture();
  f.provider.send=async()=>{throw new f.ResendRequestError('Provider unavailable.',503,60_000);};await f.worker.deliverSchoolDeadlineReminders(f.db,{now});
  f.tables.schools[0].gallery_settings.visitorDeadlineReminder.timeZone='America/Vancouver';
  f.provider.send=async(inputs,options)=>{f.batches.push({inputs,options});return inputs.map((_,i)=>({id:`accepted-${i}`}));};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T14:00:00Z')});assert.equal(f.batches.length,0);
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T16:00:00Z')});assert.equal(customer(f).length,1);
});

test('missing photographer email leaves a visible report warning and can be repaired without repeating parents',async t=>{fakeTimers(t);const f=fixture();f.tables.photographers[0].studio_email=null;
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});let status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);
  assert.equal(customer(f).length,1);assert.equal(summaries(f).length,0);assert.equal(status.summarySentAt,null);assert.match(status.message,/Add a studio or billing email/);
  f.tables.photographers[0].studio_email='studio@example.com';await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T14:00:00Z')});
  status=await f.worker.loadSchoolDeadlineReminderStatus(f.db,pgid,schoolid);assert.equal(customer(f).length,1);assert.equal(summaries(f).length,1);assert.ok(status.summarySentAt);
});

test('provider Retry-After longer than an hour is honored by later cron invocations',async t=>{fakeTimers(t);const f=fixture();let attempts=0;
  f.provider.send=async()=>{attempts++;throw new f.ResendRequestError('Wait two hours.',429,2*3_600_000,'rate_limit_exceeded');};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});assert.equal(attempts,1);
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T14:00:00Z')});assert.equal(attempts,1);
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T15:00:00Z')});assert.equal(attempts,2);
});

test('excluded contacts remain in durable reminder outcomes and never enter recipient delivery history',async t=>{fakeTimers(t);const f=fixture(251),original=f.provider.send;
  f.provider.send=async(inputs,options)=>{const result=await original(inputs,options);if(customer(f).length===1)f.photos.classes.clear();return result;};
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now});
  const run=f.tables.project_email_deliveries.find(row=>row.email_type==='school_deadline_reminder_run');
  assert.equal(run.payload.outcomes.filter(row=>row.status==='excluded').length,151);
  const history=f.tables.project_email_deliveries.filter(row=>row.email_type==='school-deadline-reminder');
  assert.equal(history.length,100);assert.ok(history.every(row=>row.status==='sent'&&row.resend_email_id));
  assert.equal(f.tables.project_email_deliveries.filter(row=>row.status==='excluded').length,0);
  const checkpoint=f.tables.project_email_deliveries.find(row=>row.email_type==='school_visitor_batch'&&row.payload.offset===100);
  assert.equal(checkpoint.payload.outcomes.filter(row=>row.status==='excluded').length,100);
  await f.worker.deliverSchoolDeadlineReminders(f.db,{now:new Date('2026-10-18T14:00:00Z')});
  assert.equal(f.tables.project_email_deliveries.filter(row=>row.email_type==='school-deadline-reminder').length,100);
});
