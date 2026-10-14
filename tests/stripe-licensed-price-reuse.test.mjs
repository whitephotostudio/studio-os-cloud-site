import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../lib/payments.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const catalogCompiled=ts.transpileModule(readFileSync(new URL('../lib/studio-pricing.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const env={STRIPE_SECRET_KEY:'sk_test_licensed_reuse_intercepted',STRIPE_BILLING_CURRENCY:'cad',STUDIO_GALLERY_PRICING_V2_ENABLED:'1'};

function fixture(rows,{allowCreate=false,meter=null}={}) {
  const catalog={};
  new Function('exports','process',catalogCompiled)(catalog,{env});
  const api={},calls=[];
  new Function('require','exports','fetch','process',compiled+'\nexports.ensureEntryForTest=ensureCatalogEntry;')(
    name=>name==='@/lib/studio-pricing'?catalog:name.startsWith('@/')?{}:require(name),api,
    async(target,options)=>{
      const url=new URL(target);
      assert.equal(url.origin,'https://api.stripe.com','all provider calls intercepted');
      const call={path:url.pathname.slice('/v1/'.length),method:options.method,query:url.searchParams,params:new URLSearchParams(options.body)};
      calls.push(call);
      if(call.path==='prices'&&call.method==='GET') {
        const row=rows.get(call.query.get('lookup_keys[]'));
        return Response.json({data:row?[row]:[],has_more:false});
      }
      if(call.path==='billing/meters'&&call.method==='GET') return Response.json({data:meter?[meter]:[],has_more:false});
      assert.equal(allowCreate,true,'an existing correct price must be reused even without a provider idempotency cache');
      if(call.path==='products'&&call.method==='POST') return Response.json({id:'prod_replacement'});
      if(call.path==='prices'&&call.method==='POST') return Response.json({id:'price_replacement'});
      assert.fail(`Unexpected provider request ${call.method} ${call.path}`);
    },{env});
  return{api,calls};
}

function planEntry(plan,interval,amount) {
  const lookupKey=`studio-os-${plan}-${interval==='year'?'annual':'monthly'}-gallery-v2`;
  return{code:`${plan}_${interval}`,name:`${plan} ${interval}`,description:'Licensed plan',currency:'cad',unitAmount:amount,interval,lookupKey};
}

test('fresh runtime reuses all six actual licensed Stripe plan prices without POST or lookup transfer',async()=>{
  const entries=[];
  const rows=new Map();
  for(const[plan,monthly,annual]of[['starter',5900,59900],['core',9900,106920],['studio',19900,214920]]) {
    for(const[interval,amount]of[['month',monthly],['year',annual]]) {
      const entry=planEntry(plan,interval,amount);
      entries.push(entry);
      rows.set(entry.lookupKey,{id:`price_existing_${plan}_${interval}`,active:true,lookup_key:entry.lookupKey,
        currency:'cad',unit_amount:amount,product:'prod_existing',
        recurring:{interval,interval_count:1,usage_type:'licensed'}});
    }
  }
  for(let restart=0;restart<2;restart++) {
    const f=fixture(rows);
    for(const entry of entries)assert.equal(await f.api.ensureEntryForTest(entry),rows.get(entry.lookupKey).id);
    assert.equal(f.calls.length,6);
    assert.ok(f.calls.every(call=>call.method==='GET'&&call.path==='prices'));
  }
});

test('licensed matching requires one month or one year and accepts old fixtures with omitted interval count',async()=>{
  const entry=planEntry('core','month',9900);
  const row={id:'price_existing',active:true,currency:'cad',unit_amount:9900,product:'prod_existing',
    recurring:{interval:'month',usage_type:'licensed'}};
  const good=fixture(new Map([[entry.lookupKey,row]]));
  assert.equal(await good.api.ensureEntryForTest(entry),'price_existing');
  const bad=fixture(new Map([[entry.lookupKey,{...row,recurring:{...row.recurring,interval_count:2}}]]),{allowCreate:true});
  assert.equal(await bad.api.ensureEntryForTest(entry),'price_replacement');
  assert.equal(bad.calls.filter(call=>call.method==='POST'&&call.path==='prices').length,1);
  assert.equal(bad.calls.at(-1).params.get('recurring[interval]'),'month');
  assert.equal(bad.calls.at(-1).params.get('unit_amount'),'9900');
});

test('licensed normalization keeps metered usage type, original rate and meter matching intact',async()=>{
  const meter={id:'meter_existing',object:'billing.meter',display_name:'Core Order Usage',event_name:'studio_os_core_order_usage',status:'active',
    default_aggregation:{formula:'sum'},customer_mapping:{type:'by_id',event_payload_key:'stripe_customer_id'},
    value_settings:{event_payload_key:'value'},event_time_window:null};
  const entry={code:'core_usage',name:meter.display_name,description:'Old usage',currency:'cad',unitAmount:35,interval:'month',
    usageType:'metered',meterEventName:meter.event_name,lookupKey:'studio-os-core-order-usage-monthly-v2'};
  const row={id:'price_usage_existing',active:true,currency:'cad',unit_amount:35,product:'prod_usage',
    recurring:{interval:'month',interval_count:1,usage_type:'metered',meter:meter.id}};
  const f=fixture(new Map([[entry.lookupKey,row]]),{meter});
  assert.equal(await f.api.ensureEntryForTest(entry),'price_usage_existing');
  assert.ok(f.calls.every(call=>call.method==='GET'));
  const wrong=fixture(new Map([[entry.lookupKey,{...row,recurring:{...row.recurring,usage_type:'licensed'}}]]),{meter,allowCreate:true});
  assert.equal(await wrong.api.ensureEntryForTest(entry),'price_replacement');
  const params=wrong.calls.at(-1).params;
  assert.equal(params.get('recurring[usage_type]'),'metered');
  assert.equal(params.get('recurring[meter]'),meter.id);
  assert.equal(params.get('unit_amount'),'35');
});
