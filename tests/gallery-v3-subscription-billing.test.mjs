import * as subscriptionCurrency from '../lib/subscription-currency.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function compile(path){return ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;}

function fixture({subscription=null}={}){
  const env={STUDIO_GALLERY_PRICING_V3_ENABLED:'1',STRIPE_SECRET_KEY:'sk_test_v3_billing_intercepted',STRIPE_BILLING_CURRENCY:'cad'};
  const pricing={};new Function('exports','process',compile('lib/studio-pricing.ts'))(pricing,{env});
  const periods={};new Function('exports',compile('lib/stripe-billing-period.ts'))(periods);
  const rows=new Map(),originalPrices=[],calls=[];
  for(const[profile,suffix]of[['legacy','v2'],['gallery_v2','gallery-v2']]){
    for(const[code,plan]of Object.entries(pricing.getPlanDefinitions(profile))){
      for(const[interval,cadence]of[['month','monthly'],['year','annual']]){
        const key=`studio-os-${code}-${cadence}-${suffix}`;
        const row={id:`price_existing_${key}`,lookup_key:key,currency:'cad',active:true,
          unit_amount:interval==='year'?plan.annualPriceCents:plan.priceCents,product:'prod_existing',
          recurring:{interval,interval_count:1,usage_type:'licensed'}};
        rows.set(key,row);originalPrices.push(structuredClone(row));
      }
    }
  }
  const api={};
  const dependencies={'@/lib/subscription-currency':subscriptionCurrency,'@/lib/studio-pricing':pricing,'@/lib/stripe-billing-period':periods,
    '@/lib/order-usage-billing':{reconcileOrderUsageFeeRefunds:async()=>{}},
    '@/lib/subscription-access':{isStripeBillingActive:status=>['active','trialing'].includes(status)},
    '@/lib/studio-os-app':{syncPhotographyKeysByPhotographerId:async()=>{}}};
  new Function('require','exports','fetch','process',compile('lib/payments.ts'))(name=>dependencies[name]??(name.startsWith('@/')?{}:require(name)),api,
    async(target,options)=>{
      const url=new URL(target);assert.equal(url.origin,'https://api.stripe.com','provider calls are entirely intercepted');
      const call={path:url.pathname.slice('/v1/'.length),method:options.method,query:url.searchParams,
        params:new URLSearchParams(options.body),headers:options.headers};calls.push(call);
      let result;
      if(call.path==='billing/meters'&&call.method==='GET')result={data:[],has_more:false};
      else if(call.path==='prices'&&call.method==='GET'){const row=rows.get(call.query.get('lookup_keys[]'));result={data:row?[row]:[],has_more:false};}
      else if(call.path==='products'&&call.method==='POST')result={id:'prod_'+call.params.get('metadata[lookup_key]')};
      else if(call.path==='prices'&&call.method==='POST'){
        const key=call.params.get('lookup_key'),interval=call.params.get('recurring[interval]');
        result={id:'price_'+key,lookup_key:key,currency:call.params.get('currency'),unit_amount:Number(call.params.get('unit_amount')),
          active:true,product:call.params.get('product'),recurring:interval?{interval,interval_count:1,usage_type:'licensed'}:null};rows.set(key,result);
      }
      else if(call.path==='checkout/sessions'&&call.method==='POST')result={id:'cs_unpaid_fixture_'+calls.length,url:'https://checkout.stripe.invalid/fixture'};
      else if(call.path==='subscriptions/sub_existing'&&call.method==='GET')result=subscription;
      else if(call.path==='subscriptions/sub_existing'&&call.method==='POST'){
        assert.ok(subscription);
        for(const[key,value]of call.params){
          const metadataKey=key.match(/^metadata\[([^\]]+)\]$/)?.[1];
          if(metadataKey)subscription.metadata[metadataKey]=value;
        }
        result=subscription;
      }else if(call.path==='subscription_items/si_keys_existing'&&call.method==='DELETE'){
        subscription.items.data=subscription.items.data.filter(item=>item.id!=='si_keys_existing');
        result={id:'si_keys_existing',deleted:true};
      }else assert.fail(`Unexpected provider request ${call.method} ${call.path}`);
      return Response.json(result);
    },{env});
  return{api,pricing,rows,originalPrices,calls,subscription};
}

function oldStudioSubscription(profile='gallery_v2'){
  return{id:'sub_existing',customer:'cus_existing',status:'active',billing_mode:{type:'classic'},
    metadata:{photographer_id:'studio',plan_code:'studio',billing_interval:'month',pricing_profile:profile},
    items:{data:[{id:'si_base_existing',quantity:1,current_period_start:1788220800,current_period_end:1790812800,
      price:{id:'price_old_base',currency:'cad',unit_amount:19900,lookup_key:`studio-os-studio-monthly-${profile==='legacy'?'v2':'gallery-v2'}`,
        recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}},
      {id:'si_keys_existing',quantity:1,price:{id:'price_old_keys',currency:'cad',unit_amount:5500,
        lookup_key:'studio-os-extra-desktop-key-monthly-v2',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}};
}

test('all six V3 subscription checkouts select versioned exact CAD prices and metadata without monthly meters or old-price changes',async()=>{
  const f=fixture();const catalog=await f.api.ensureStripeCatalog();
  assert.deepEqual(catalog.usagePriceIds,{starter:null,core:null,studio:null});
  for(const[code,monthly,annual]of[['starter',5900,59900],['core',9900,106920],['studio',19900,214920]]){
    for(const[interval,cadence,amount]of[['month','monthly',monthly],['year','annual',annual]]){
      const key=`studio-os-${code}-${cadence}-gallery-v3`,price=f.rows.get(key);
      assert.equal(price.unit_amount,amount);assert.equal(price.currency,'cad');
      assert.equal(catalog.planPrices[code][interval],price.id);
      await f.api.createPlanCheckoutSession({customerId:'cus_new',photographerId:'studio',userId:'user',planCode:code,
        billingInterval:interval,extraDesktopKeys:0,successUrl:'https://example.invalid/success',cancelUrl:'https://example.invalid/cancel'});
      const call=f.calls.at(-1);assert.equal(call.path,'checkout/sessions');
      assert.equal(call.headers['Stripe-Account'],undefined,'photographer subscription stays on Studio OS platform account');
      assert.equal(call.params.get('line_items[0][price]'),price.id);
      assert.equal(call.params.get('metadata[pricing_profile]'),'gallery_v3');
      assert.equal(call.params.get('subscription_data[metadata][pricing_profile]'),'gallery_v3');
      assert.equal(call.params.get('subscription_data[metadata][photographer_id]'),'studio');
      assert.equal(call.params.get('line_items[1][price]'),null);
      assert.equal(call.params.get('subscription_data[billing_mode][type]'),null,'direct-fee annual plans need no monthly meter');
    }
  }
  for(const old of f.originalPrices)assert.deepEqual(f.rows.get(old.lookup_key),old);
  assert.ok(f.calls.every(call=>!(call.path==='billing/meters'&&call.method!=='GET')));
  assert.ok(f.calls.every(call=>!call.path.startsWith('subscription_items')&&!call.path.startsWith('subscriptions/')));
});

test('routine V3 renewal sync recognizes monthly/yearly Gallery/Core/Studio and never attaches or reports monthly order usage',async()=>{
  const f=fixture();f.calls.length=0;
  for(const code of ['starter','core','studio'])for(const interval of ['month','year']){
    const photographer={id:'studio',user_id:'user',subscription_plan_code:code,subscription_status:'active',
      stripe_subscription_item_usage_id:null,stripe_connected_account_id:'acct_unchanged',billing_currency:'cad'};
    const subscription={id:'sub_new',customer:'cus_new',status:'active',metadata:{pricing_profile:'gallery_v3',plan_code:code,billing_interval:interval},
      items:{data:[{id:'si_base',current_period_start:1788220800,current_period_end:interval==='year'?1819756800:1790812800,
        price:{id:'price_new',lookup_key:`studio-os-${code}-${interval==='year'?'annual':'monthly'}-gallery-v3`,currency:'cad',
          unit_amount:interval==='year'?f.pricing.getPlanDefinitions('gallery_v3')[code].annualPriceCents:f.pricing.getPlanDefinitions('gallery_v3')[code].priceCents,
          recurring:{interval,interval_count:1,usage_type:'licensed'}}}]}};
    const service={from(table){
      if(table==='photographers')return{update(values){
        return{async eq(){Object.assign(photographer,values);return{error:null};}};
      }};
      assert.equal(table,'subscriptions');return{async upsert(){return{error:null};}};
    }};
    for(let repeat=0;repeat<2;repeat++){
      const result=await f.api.syncSubscriptionStateFromStripe(service,photographer,subscription);
      assert.equal(result.planCode,code);assert.equal(result.usageItemId,null);assert.equal(result.photographer.order_usage_rate_cents,0);
      assert.equal(subscription.items.data.length,1);
    }
  }
  assert.equal(f.calls.length,0);
});

async function actualKeyChange({action='update_extra_keys',profile='gallery_v2',extraDesktopKeys=3,extraItem=true}={}){
  const old=oldStudioSubscription(profile);
  if(!extraItem)old.items.data=old.items.data.filter(item=>item.id!=='si_keys_existing');
  const f=fixture({subscription:old});await f.api.ensureStripeCatalog();f.calls.length=0;
  const photographer={id:'studio',stripe_subscription_id:'sub_existing',stripe_platform_customer_id:'cus_existing',subscription_status:'active',subscription_plan_code:'studio'};
  const service={};const handler={};
  const dependencies={'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    '@/lib/credit-maintenance':{creditMaintenanceActive:()=>false},
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:'user'}}),createDashboardServiceClient:()=>service},
    '@/lib/payments':{...f.api,getOrCreatePhotographerByUser:async()=>photographer,ensurePlatformCustomer:async()=>'cus_existing',
      syncSubscriptionStateFromStripe:async(_service,current,subscription)=>({photographer:current,subscription,planCode:'studio'})}};
  new Function('require','exports',compile('app/api/stripe/billing/route.ts'))(name=>dependencies[name]??{},handler);
  const response=await handler.POST(new Request('https://example.invalid/api/stripe/billing',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action,planCode:'studio',billingInterval:'month',extraDesktopKeys,pricingProfile:'gallery_v3'})}));
  assert.equal(response.status,200);
  const update=f.calls.find(call=>call.path==='subscriptions/sub_existing'&&call.method==='POST');
  return{f,update};
}

test('actual extra-key billing action retains an existing V2 base price/profile instead of accepting V3 order fees',async()=>{
  const {f,update}=await actualKeyChange();
  assert.ok(update);assert.equal(update.params.get('metadata[pricing_profile]'),'gallery_v2');
  assert.equal(update.params.get('metadata[extra_desktop_keys]'),'3');
  assert.equal(update.params.get('items[0][id]'),'si_keys_existing');
  assert.equal(update.params.get('items[0][quantity]'),'3');
  assert.ok([...update.params.values()].every(value=>value!=='si_base_existing'&&!value.includes('gallery-v3')));
  assert.equal(f.subscription.items.data[0].price.id,'price_old_base');
  assert.equal(f.subscription.metadata.pricing_profile,'gallery_v2');
  assert.ok(f.calls.every(call=>call.path==='subscriptions/sub_existing'),'no unrelated catalog/meter/account writes');
});

test('key-only changes cannot hide a plan/cadence switch while an explicit reviewed plan update selects V3',async()=>{
  const f=fixture({subscription:oldStudioSubscription()});await f.api.ensureStripeCatalog();f.calls.length=0;
  for(const change of [{planCode:'core',billingInterval:'month'},{planCode:'studio',billingInterval:'year'}]){
    await assert.rejects(f.api.updateStripeSubscriptionConfiguration({subscriptionId:'sub_existing',customerId:'cus_existing',photographerId:'studio',extraDesktopKeys:2,preserveBasePlan:true,...change}),/current plan and billing interval/);
  }
  assert.ok(f.calls.every(call=>call.method==='GET'));
  await f.api.updateStripeSubscriptionConfiguration({subscriptionId:'sub_existing',customerId:'cus_existing',photographerId:'studio',planCode:'studio',billingInterval:'month',extraDesktopKeys:1});
  const update=f.calls.find(call=>call.method==='POST');
  assert.equal(update.params.get('items[0][id]'),'si_base_existing');
  assert.equal(update.params.get('items[0][price]'),'price_studio-os-studio-monthly-gallery-v3');
  assert.equal(update.params.get('metadata[pricing_profile]'),'gallery_v3');
});

test('older update_plan clients changing only key quantity retain the actual V2 or legacy price and fee contract',async()=>{
  for(const profile of ['gallery_v2','legacy']) {
    const {f,update}=await actualKeyChange({action:'update_plan',profile,extraDesktopKeys:3});
    assert.equal(update.params.get('metadata[pricing_profile]'),profile);
    assert.equal(update.params.get('metadata[extra_desktop_keys]'),'3');
    assert.equal(update.params.get('items[0][id]'),'si_keys_existing');
    assert.equal(update.params.get('items[0][quantity]'),'3');
    assert.ok([...update.params.values()].every(value=>value!=='si_base_existing'&&!value.includes('gallery-v3')));
    assert.equal(f.subscription.items.data[0].price.id,'price_old_base');
    assert.equal(f.subscription.metadata.pricing_profile,profile);
    assert.ok(f.calls.every(call=>call.path==='subscriptions/sub_existing'));
  }
  const added=await actualKeyChange({action:'update_plan',profile:'gallery_v2',extraDesktopKeys:1,extraItem:false});
  assert.equal(added.update.params.get('metadata[pricing_profile]'),'gallery_v2');
  assert.equal(added.update.params.get('items[0][quantity]'),'1');
  assert.ok([...added.update.params.values()].every(value=>value!=='si_base_existing'&&!value.includes('gallery-v3')));
});

test('actual plan or cadence changes can accept V3 even when the requested key quantity changes too',async()=>{
  for(const[planCode,billingInterval,keyQuantity,expectedPrice]of[
    ['core','month',0,'price_studio-os-core-monthly-gallery-v3'],
    ['studio','year',3,'price_studio-os-studio-annual-gallery-v3'],
  ]) {
    const f=fixture({subscription:oldStudioSubscription()});await f.api.ensureStripeCatalog();f.calls.length=0;
    await f.api.updateStripeSubscriptionConfiguration({subscriptionId:'sub_existing',customerId:'cus_existing',photographerId:'studio',planCode,billingInterval,extraDesktopKeys:keyQuantity});
    const update=f.calls.find(call=>call.path==='subscriptions/sub_existing'&&call.method==='POST');
    assert.equal(update.params.get('items[0][id]'),'si_base_existing');
    assert.equal(update.params.get('items[0][price]'),expectedPrice);
    assert.equal(update.params.get('metadata[pricing_profile]'),'gallery_v3');
  }
});
