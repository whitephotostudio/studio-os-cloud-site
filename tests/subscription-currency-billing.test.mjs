import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as currencyApi from '../lib/subscription-currency.ts';
import * as orderCurrency from '../lib/order-currency.ts';

const require=createRequire(import.meta.url);
const compile=path=>ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledPayments=compile('lib/payments.ts'),compiledPricing=compile('lib/studio-pricing.ts');

function fixture({enabled=true,pricingEnabled=true}={}){
  const env={STRIPE_SECRET_KEY:'sk_test_local_currency_intercepted',STRIPE_BILLING_CURRENCY:'cad',
    ...(enabled?{STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:'1'}:{}),...(pricingEnabled?{STUDIO_GALLERY_PRICING_V3_ENABLED:'1'}:{})};
  const pricing={};new Function('exports','process',compiledPricing)(pricing,{env});
  const periods={};new Function('exports',compile('lib/stripe-billing-period.ts'))(periods);
  const rows=new Map(),subscriptions=new Map(),calls=[];
  for(const profile of ['legacy','gallery_v2','gallery_v3'])for(const[code,plan]of Object.entries(pricing.getPlanDefinitions(profile))){
    for(const interval of ['month','year']){
      const currencies=profile==='gallery_v3'?currencyApi.SUBSCRIPTION_CURRENCIES:['cad'];
      for(const currency of currencies){
        const suffix=profile==='legacy'?'v2':profile==='gallery_v2'?'gallery-v2':'gallery-v3';
        const key=profile==='gallery_v3'?currencyApi.subscriptionPlanLookupKey(code,interval,currency)
          :`studio-os-${code}-${interval==='year'?'annual':'monthly'}-${suffix}`;
        rows.set(key,{id:'price_'+key,lookup_key:key,currency,active:true,product:'prod_existing',
          unit_amount:interval==='year'?plan.annualPriceCents:plan.priceCents,recurring:{interval,interval_count:1,usage_type:'licensed'}});
      }
    }
  }
  for(const currency of currencyApi.SUBSCRIPTION_CURRENCIES)for(const interval of ['month','year']){
    const key=currencyApi.subscriptionExtraKeyLookupKey(interval,currency);
    rows.set(key,{id:'price_'+key,lookup_key:key,currency,active:true,product:'prod_existing',
      unit_amount:interval==='year'?59400:5500,recurring:{interval,interval_count:1,usage_type:'licensed'}});
  }
  for(const pack of Object.values(pricing.CREDIT_PACK_DEFS)){
    const quantity=pack.code.split('_').at(-1),key=`studio-os-background-credits-${quantity}-v2`;
    rows.set(key,{id:'price_'+key,lookup_key:key,currency:'cad',active:true,product:'prod_existing',unit_amount:pack.priceCents,recurring:null});
  }
  const api={},dependencies={'@/lib/studio-pricing':pricing,'@/lib/order-currency':orderCurrency,'@/lib/subscription-currency':{
    ...currencyApi,localSubscriptionBillingEnabled:()=>currencyApi.localSubscriptionBillingEnabled(env)},
    '@/lib/stripe-billing-period':periods,'@/lib/order-usage-billing':{reconcileOrderUsageFeeRefunds:async()=>{}},
    '@/lib/subscription-access':{isStripeBillingActive:status=>['active','trialing'].includes(status)},
    '@/lib/studio-os-app':{syncPhotographyKeysByPhotographerId:async()=>{}}};
  const fetch=async(target,options)=>{
    const url=new URL(target);assert.equal(url.origin,'https://api.stripe.com');
    const call={path:url.pathname.slice(4),method:options.method,params:new URLSearchParams(options.body),query:url.searchParams,headers:options.headers};calls.push(call);
    let result;
    if(call.path==='billing/meters'&&call.method==='GET')result={data:[],has_more:false};
    else if(call.path==='prices'&&call.method==='GET'){const row=rows.get(call.query.get('lookup_keys[]'));result={data:row?[row]:[],has_more:false};}
    else if(call.path==='products'&&call.method==='POST')result={id:'prod_'+call.params.get('metadata[lookup_key]')};
    else if(call.path==='prices'&&call.method==='POST'){
      const key=call.params.get('lookup_key'),interval=call.params.get('recurring[interval]');
      result={id:'price_'+key,lookup_key:key,currency:call.params.get('currency'),unit_amount:Number(call.params.get('unit_amount')),
        active:true,product:call.params.get('product'),recurring:interval?{interval,interval_count:1,usage_type:'licensed'}:null};rows.set(key,result);
    }else if(call.path==='checkout/sessions'&&call.method==='POST')result={id:'cs_intercepted',url:'https://checkout.stripe.invalid/intercepted'};
    else if(call.path.startsWith('subscriptions/')&&call.method==='GET'){
      result=subscriptions.get(call.path.slice('subscriptions/'.length));assert.ok(result,'only saved synthetic subscriptions may be retrieved');
    }else if(call.path.startsWith('subscriptions/')&&call.method==='POST'){
      result=subscriptions.get(call.path.slice('subscriptions/'.length));assert.ok(result);
      for(const[key,value]of call.params){const metadata=key.match(/^metadata\[([^\]]+)\]$/)?.[1];if(metadata)result.metadata[metadata]=value;}
      for(let index=0;call.params.has(`items[${index}][price]`);index++){
        const id=call.params.get(`items[${index}][id]`),priceId=call.params.get(`items[${index}][price]`);
        const price=[...rows.values()].find(row=>row.id===priceId);assert.ok(price);
        let item=result.items.data.find(row=>row.id===id);
        if(!item){item={id:'si_added_'+index};result.items.data.push(item);}
        item.price=structuredClone(price);item.quantity=Number(call.params.get(`items[${index}][quantity]`)??1);
      }
      assert.equal(new Set(result.items.data.map(item=>item.price.currency)).size,1,'subscription changes cannot mix currencies');
    }else if(call.path.startsWith('subscription_items/')&&call.method==='DELETE'){
      const id=call.path.slice('subscription_items/'.length);for(const subscription of subscriptions.values())subscription.items.data=subscription.items.data.filter(item=>item.id!==id);
      result={id,deleted:true};
    }else assert.fail(`Unexpected provider request ${call.method} ${call.path}`);
    return Response.json(result);
  };
  new Function('require','exports','fetch','process',compiledPayments)(name=>dependencies[name]??(name.startsWith('@/')?{}:require(name)),api,fetch,{env});
  function addSubscription({currency='usd',profile='gallery_v3',plan='studio',interval='month',keys=1}={}){
    const suffix=profile==='legacy'?'v2':profile==='gallery_v2'?'gallery-v2':'gallery-v3';
    const key=profile==='gallery_v3'?currencyApi.subscriptionPlanLookupKey(plan,interval,currency):`studio-os-${plan}-${interval==='year'?'annual':'monthly'}-${suffix}`;
    const subscription={id:'sub_existing',customer:'cus_owner',status:'active',metadata:{photographer_id:'studio',plan_code:plan,billing_interval:interval,pricing_profile:profile,
      ...(currency!=='cad'?{subscription_currency:currency}:{})},items:{data:[{id:'si_base',quantity:1,current_period_start:1790812800,current_period_end:1793491200,price:structuredClone(rows.get(key))}]}};
    if(keys)subscription.items.data.push({id:'si_keys',quantity:keys,price:structuredClone(rows.get(currencyApi.subscriptionExtraKeyLookupKey(interval,currency)))});
    subscriptions.set(subscription.id,subscription);
    return subscription;
  }
  const photographer={id:'studio',user_id:'owner',stripe_subscription_id:'sub_existing',stripe_platform_customer_id:'cus_owner',business_country:'CA',stripe_connect_country:'CA',
    billing_currency:'cad',subscription_plan_code:'studio',subscription_status:'active',stripe_subscription_item_usage_id:null};
  return{api,pricing,rows,calls,env,addSubscription,photographer,subscriptions};
}

const checkout={customerId:'cus_owner',photographerId:'studio',userId:'owner',planCode:'studio',billingInterval:'month',extraDesktopKeys:0,
  successUrl:'https://example.invalid/success',cancelUrl:'https://example.invalid/cancel'};

test('country mapping is separate from sales currency and localized rollout is exact and reversible',async()=>{
  for(const[country,currency]of[['CA','cad'],['US','usd'],['AU','aud'],['GB','gbp']]){
    const f=fixture();assert.equal(await f.api.resolveSubscriptionCurrency({id:'studio',business_country:country,billing_currency:'eur'}),currency);
  }
  for(const country of [null,'','FR','UK'])assert.throws(()=>currencyApi.subscriptionCurrencyForCountry(country),currencyApi.SubscriptionCurrencyError);
  const on=fixture();await assert.rejects(on.api.resolveSubscriptionCurrency({id:'studio',billing_currency:'usd'}),error=>error.name==='SubscriptionCurrencyError'&&error.status===400);
  const off=fixture({enabled:false});assert.equal(await off.api.resolveSubscriptionCurrency({id:'studio',business_country:'US'}),'cad');
  for(const flag of ['1','true'])assert.equal(currencyApi.localSubscriptionBillingEnabled({STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:flag}),true);
  for(const flag of ['TRUE','yes','0',undefined])assert.equal(currencyApi.localSubscriptionBillingEnabled({STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:flag}),false);
});

test('four independent catalogs keep all 24 plan prices, eight keys and unchanged CAD credit prices without catalog writes',async()=>{
  const f=fixture(),before=structuredClone([...f.rows]);
  const catalogs=await Promise.all(currencyApi.SUBSCRIPTION_CURRENCIES.map(currency=>f.api.ensureStripeCatalog(currency)));
  for(const catalog of catalogs){
    assert.equal(catalog.pricingProfile,'gallery_v3');assert.deepEqual(catalog.usagePriceIds,{starter:null,core:null,studio:null});
    for(const code of ['starter','core','studio'])for(const interval of ['month','year']){
      const key=currencyApi.subscriptionPlanLookupKey(code,interval,catalog.currency),price=f.rows.get(key);
      assert.equal(catalog.planPrices[code][interval],price.id);assert.equal(price.currency,catalog.currency);
    }
    for(const interval of ['month','year'])assert.equal(catalog.extraDesktopKeyPriceIds[interval],f.rows.get(currencyApi.subscriptionExtraKeyLookupKey(interval,catalog.currency)).id);
    for(const id of Object.values(catalog.creditPackPriceIds))assert.equal([...f.rows.values()].find(row=>row.id===id).currency,'cad');
  }
  assert.deepEqual([...f.rows],before);assert.ok(f.calls.every(call=>call.method==='GET'));
  const count=f.calls.length;await Promise.all([f.api.ensureStripeCatalog('usd'),f.api.ensureStripeCatalog('cad')]);assert.equal(f.calls.length,count,'cache is indexed by currency');
  assert.equal(f.calls.filter(call=>call.path==='prices'&&call.query.get('lookup_keys[]')?.includes('background-credits')).length,5,'one CAD credit catalog is shared');
});

test('localized catalog creation uses unique keys and never transfers an existing conflicting lookup',async()=>{
  const f=fixture();const key=currencyApi.subscriptionPlanLookupKey('starter','month','usd');f.rows.delete(key);
  await f.api.ensureStripeCatalog('usd');const created=f.calls.find(call=>call.path==='prices'&&call.method==='POST');
  assert.equal(created.params.get('lookup_key'),key);assert.equal(created.params.get('currency'),'usd');assert.equal(created.params.get('unit_amount'),'5900');assert.equal(created.params.get('transfer_lookup_key'),null);
  const g=fixture();g.rows.get(key).currency='cad';await assert.rejects(g.api.ensureStripeCatalog('usd'),/localized subscription price/);
  assert.ok(g.calls.every(call=>call.method==='GET'));
});

test('every localized checkout uses the exact base and matching extra-key currency with no usage meter or sales routing',async()=>{
  const f=fixture();
  for(const currency of currencyApi.SUBSCRIPTION_CURRENCIES)for(const planCode of ['starter','core','studio'])for(const billingInterval of ['month','year']){
    await f.api.createPlanCheckoutSession({...checkout,planCode,billingInterval,subscriptionCurrency:currency,extraDesktopKeys:planCode==='studio'?2:0});
    const call=f.calls.at(-1),key=currencyApi.subscriptionPlanLookupKey(planCode,billingInterval,currency);
    assert.equal(call.params.get('line_items[0][price]'),f.rows.get(key).id);assert.equal(call.params.get('subscription_data[metadata][subscription_currency]'),currency);
    assert.equal(call.params.get('metadata[pricing_profile]'),'gallery_v3');assert.equal(call.headers['Stripe-Account'],undefined);
    assert.equal(call.params.get('subscription_data[billing_mode][type]'),null);
    if(planCode==='studio')assert.equal(call.params.get('line_items[1][price]'),f.rows.get(currencyApi.subscriptionExtraKeyLookupKey(billingInterval,currency)).id);
  }
  const off=fixture({enabled:false});await assert.rejects(off.api.createPlanCheckoutSession({...checkout,subscriptionCurrency:'usd'}),error=>error.status===409);
  assert.equal(off.calls.length,0,'disabled localized enrollment cannot create a customer checkout or catalog');
});

test('existing actual subscription currency overrides country, sales currency and public rollout flags',async()=>{
  for(const currency of currencyApi.SUBSCRIPTION_CURRENCIES)for(const plan of ['starter','core','studio']){
    const f=fixture({enabled:false,pricingEnabled:false}),subscription=f.addSubscription({currency,plan,keys:plan==='studio'?1:0});
    assert.equal(await f.api.resolveSubscriptionCurrency({...f.photographer,business_country:'US',billing_currency:'aud'}),currency);
    assert.equal(await f.api.resolveSubscriptionCurrency(f.photographer,subscription),currency);
    const policy=await f.api.resolveDirectOrderPricingPolicy(f.photographer,false);assert.equal(policy.pricingProfile,'gallery_v3');
    const fee=await f.api.quoteDirectOrderPlatformFees({...policy,currency:'cad',isPlatformAdmin:false,orders:[{id:'order',totalCents:3000}]});assert.equal(fee.rateCents,plan==='starter'?55:45);assert.equal(fee.currency,'cad');
  }
});

test('foreign price recognition rejects wrong customer, owner, amount, currency, profile, recurring settings and conflicting extras',async()=>{
  const mutations=[s=>s.customer='cus_foreign',s=>s.metadata.photographer_id='foreign',s=>s.metadata.pricing_profile='gallery_v2',s=>s.metadata.subscription_currency='cad',
    s=>s.items.data[0].price.unit_amount++,s=>s.items.data[0].price.currency='cad',s=>s.items.data[0].quantity=2,s=>s.items.data[0].price.recurring.interval='year',
    s=>s.items.data[0].price.recurring.usage_type='metered',s=>s.items.data[0].price.recurring.interval_count=2,s=>s.items.data[1].price.currency='cad',
    s=>s.items.data[1].price.unit_amount++,s=>s.items.data.push(structuredClone(s.items.data[0])),s=>delete s.metadata.subscription_currency];
  for(const mutate of mutations){
    const f=fixture(),s=f.addSubscription();mutate(s);
    await assert.rejects(f.api.resolveSubscriptionCurrency(f.photographer),error=>error.status===409);
    await assert.rejects(f.api.resolveDirectOrderPricingPolicy(f.photographer,false));
    assert.ok(f.calls.every(call=>call.method==='GET'));
  }
});

test('plan, cadence and key changes preserve actual currency when creation is off; key-only keeps the exact base',async()=>{
  for(const currency of currencyApi.SUBSCRIPTION_CURRENCIES){
    for(const change of [{planCode:'studio',billingInterval:'month',extraDesktopKeys:3,preserveBasePlan:true},{planCode:'core',billingInterval:'month',extraDesktopKeys:0},
      {planCode:'studio',billingInterval:'year',extraDesktopKeys:2}]){
      const f=fixture({enabled:false}),subscription=f.addSubscription({currency}),baseId=subscription.items.data[0].price.id;
      await f.api.updateStripeSubscriptionConfiguration({subscriptionId:'sub_existing',customerId:'cus_owner',photographerId:'studio',...change});
      assert.equal(subscription.items.data[0].price.currency,currency);assert.equal(subscription.metadata.subscription_currency,currency);
      if(change.preserveBasePlan)assert.equal(subscription.items.data[0].price.id,baseId);
      for(const item of subscription.items.data)assert.equal(item.price.currency,currency);
      assert.ok(f.calls.every(call=>call.path!=='customers'&&call.method!=='DELETE'||call.path.startsWith('subscription_items/')));
    }
  }
});

test('legacy and V2 key-only changes keep original base price/profile and foreign ownership fails before writes',async()=>{
  for(const profile of ['legacy','gallery_v2']){
    const f=fixture(),s=f.addSubscription({profile,currency:'cad'}),before=structuredClone(s.items.data[0]);
    await f.api.updateStripeSubscriptionConfiguration({subscriptionId:s.id,customerId:s.customer,photographerId:'studio',planCode:'studio',billingInterval:'month',extraDesktopKeys:3,preserveBasePlan:true});
    assert.deepEqual(s.items.data[0],before);assert.equal(s.metadata.pricing_profile,profile);
  }
  const f=fixture();f.addSubscription();await assert.rejects(f.api.updateStripeSubscriptionConfiguration({subscriptionId:'sub_existing',customerId:'cus_attacker',photographerId:'studio',
    planCode:'core',billingInterval:'month',extraDesktopKeys:0}),/ownership/);assert.ok(f.calls.every(call=>call.method==='GET'));
});

test('first localized subscription sync records actual invoice currency while preserving selected customer sales currency',async()=>{
  const f=fixture(),subscription=f.addSubscription({currency:'usd',keys:0}),photographer={...f.photographer,stripe_subscription_id:null,billing_currency:'cad'},mirrors=[];
  const service={from(table){if(table==='photographers')return{update(values){assert.equal('billing_currency'in values,false);return{async eq(){Object.assign(photographer,values);return{error:null};}};}};
    assert.equal(table,'subscriptions');return{async upsert(values){mirrors.push(values);return{error:null};}};}};
  await f.api.syncSubscriptionStateFromStripe(service,photographer,subscription);
  assert.equal(photographer.billing_currency,'cad');assert.equal(mirrors[0].billing_currency,'usd');assert.equal(photographer.order_usage_rate_cents,0);assert.equal(f.calls.length,0);
});

test('an unknown localized subscription cannot fall through to legacy usage repair when public pricing is disabled',async()=>{
  const f=fixture({enabled:false,pricingEnabled:false}),subscription=f.addSubscription({currency:'usd',keys:0});
  subscription.items.data[0].price.lookup_key='studio-os-studio-monthly-unrecognized-usd';
  const service={from(){assert.fail('unverified localized ownership/price must fail before any database write');}};
  await assert.rejects(f.api.syncSubscriptionStateFromStripe(service,f.photographer,subscription),error=>error.status===409);
  assert.equal(f.calls.length,0,'there is no metered-price repair or provider mutation');
});

test('CAD credit checkout is unchanged after every localized catalog has been loaded',async()=>{
  const f=fixture();for(const currency of currencyApi.SUBSCRIPTION_CURRENCIES)await f.api.ensureStripeCatalog(currency);
  await f.api.createCreditsCheckoutSession({customerId:'cus_owner',photographerId:'studio',userId:'owner',packCode:'background_credits_250',creditPackageId:'pack',successUrl:'https://example.invalid/ok',cancelUrl:'https://example.invalid/cancel'});
  const call=f.calls.at(-1);assert.equal(call.params.get('metadata[currency]'),'cad');assert.equal(call.params.get('line_items[0][price]'),'price_studio-os-background-credits-250-v2');
});
