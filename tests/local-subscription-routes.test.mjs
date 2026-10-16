import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as pricing from '../lib/studio-pricing.ts';

const compile = path => ts.transpileModule(readFileSync(new URL('../'+path, import.meta.url), 'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const currency = {};
new Function('exports', 'process', compile('lib/subscription-currency.ts'))(currency, {env:{STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:'1'}});

function fixture({country='US', savedSubscription=false, unavailable=false, subscriptionStatus='active'}={}) {
  const calls=[];
  const photographer={id:'photo',user_id:'owner',business_country:country,billing_currency:'cad',
    stripe_platform_customer_id:savedSubscription?'cus_saved':null,
    stripe_subscription_id:savedSubscription?'sub_saved':null,subscription_status:savedSubscription?subscriptionStatus:'trial'};
  const subscription={id:'sub_saved',customer:'cus_saved',status:'active'};
  const payments={...pricing,
    getOrCreatePhotographerByUser:async()=>photographer,
    ensurePlatformCustomer:async()=>{calls.push(['customer']);return savedSubscription?'cus_saved':'cus_new';},
    retrieveStripeSubscription:async()=>subscription,
    syncSubscriptionStateFromStripe:async(_service,current)=>({photographer:current,subscription,planCode:'studio',extraDesktopKeys:2}),
    resolveSubscriptionCurrency:async current=>{
      calls.push(['resolve']);
      if(unavailable)throw new currency.SubscriptionCurrencyError('Cannot verify the existing subscription.',409);
      return savedSubscription?'cad':currency.subscriptionCurrencyForCountry(current.business_country);
    },
    createPlanCheckoutSession:async input=>{calls.push(['subscribe',input]);return{id:'cs_test',url:'https://checkout.stripe.com/test'};},
    updateStripeSubscriptionConfiguration:async input=>{calls.push(['update',input]);return subscription;},
    ensureCreditPackageCatalog:async()=>[{id:'pack',code:'background_credits_250'}],
    createCreditsCheckoutSession:async input=>{calls.push(['credits',input]);return{id:'cs_credit_test',url:'https://checkout.stripe.com/credits'};},
    createBillingPortalSession:async()=>({url:'https://billing.stripe.com/test'}),
    billingReturnUrl:(_origin,result)=>'https://example.invalid/settings?billing='+result,
  };
  const modules={'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},
    '@/lib/credit-maintenance':{creditMaintenanceActive:()=>false},
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:'owner'}}),createDashboardServiceClient:()=>({})},
    '@/lib/payments':payments};
  const api={};
  new Function('require','exports',compile('app/api/stripe/billing/route.ts'))(name=>{
    assert.ok(name in modules,'Unexpected dependency '+name);return modules[name];
  },api);
  return{calls,invoke:body=>api.POST(new Request('https://example.invalid/api/stripe/billing',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({action:'subscribe',planCode:'studio',billingInterval:'month',...body})}))};
}

test('subscription endpoint uses saved country, ignoring posted currency and sales currency',async()=>{
  for(const[country,expected]of[['CA','cad'],['US','usd'],['AU','aud'],['GB','gbp']]){
    const f=fixture({country});
    const response=await f.invoke({currency:'gbp',subscriptionCurrency:'aud',businessCountry:'AU'});
    assert.equal(response.status,200);assert.equal((await response.json()).subscriptionCurrency,expected);
    assert.equal(f.calls.find(([type])=>type==='subscribe')[1].subscriptionCurrency,expected);
  }
});

test('missing business country fails before creating customer or subscription Checkout',async()=>{
  const f=fixture({country:null});const response=await f.invoke({businessCountry:'US'});
  assert.equal(response.status,400);assert.match((await response.json()).message,/business country/);
  assert.deepEqual(f.calls.map(([type])=>type),['resolve']);
});

test('a canceled regional subscription starts a fresh Checkout and never updates the old contract',async()=>{
  for(const country of ['AU','GB'])for(const subscriptionStatus of ['canceled','incomplete_expired']){
    const f=fixture({country,savedSubscription:true,subscriptionStatus});const response=await f.invoke({});
    assert.equal(response.status,200);assert.ok(f.calls.some(([type])=>type==='subscribe'));
    assert.equal(f.calls.some(([type])=>type==='update'),false);
  }
});

test('existing CAD subscribers retain currency and customer during key-only save',async()=>{
  const f=fixture({country:'US',savedSubscription:true});
  const response=await f.invoke({action:'update_extra_keys',extraDesktopKeys:3});
  assert.equal(response.status,200);assert.equal((await response.json()).subscriptionCurrency,'cad');
  const update=f.calls.find(([type])=>type==='update')[1];
  assert.equal(update.customerId,'cus_saved');assert.equal(update.preserveBasePlan,true);
  assert.ok(!f.calls.some(([type])=>type==='subscribe'));
});

test('unverifiable saved subscription cannot create a replacement customer or Checkout',async()=>{
  const f=fixture({savedSubscription:true,unavailable:true});const response=await f.invoke({});
  assert.equal(response.status,409);assert.deepEqual(f.calls.map(([type])=>type),['resolve']);
});

test('credit purchase remains independent of subscription-country selection',async()=>{
  const f=fixture({country:null});const response=await f.invoke({action:'buy_credits',packCode:'background_credits_250'});
  assert.equal(response.status,200);assert.deepEqual(f.calls.map(([type])=>type),['customer','credits']);
  assert.equal(f.calls[1][1].packCode,'background_credits_250');
  assert.equal(f.calls[1][1].subscriptionCurrency,undefined);
});
