import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { getPlanDefinitions } from '../lib/studio-pricing.ts';

const require = createRequire(import.meta.url);
const settingsSource = readFileSync(new URL('../app/dashboard/settings/page.tsx', import.meta.url), 'utf8');

/** Mount the actual Settings component and click its real billing Save button. */
function harness({ profile = 'gallery_v2', stripeConnectUrl = null, expectedPlanDisabled = false, ...state } = {}) {
  const fixture = { loading: false, sessionReady: true, signedIn: true, error: null,
    stripeSubscriptionId: 'sub_existing', subscriptionPlanCode: 'studio', subscriptionBillingInterval: 'month',
    subscriptionStatus: 'active', subscriptionIsActive: true, extraDesktopKeys: 1,
    desiredPlanCode: 'studio', desiredBillingInterval: 'month', desiredExtraDesktopKeys: 3,
    ...(stripeConnectUrl ? {connecting:false,businessCountry:'CA',connectReadyForPayments:true,stripeAccountType:'standard',stripeDashboardType:'full',stripePendingAccountId:null} : {}),
    billingCatalog: { pricingProfile: profile, currency: 'cad', galleryStoragePolicy: 'existing',
      plans: Object.values(getPlanDefinitions(profile)), annualDiscountPercent: 10,
      extraDesktopKeyMonthlyCents: 5500, extraDesktopKeyAnnualCents: 59400, creditPacks: [] }, ...state };
  const injected = new Set(), calls = [], errors = [], stateUpdates = {};
  let initializedStateName;
  const compiled = ts.transpileModule(settingsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    transformers: { before: [context => {
      const visit = node => {
        if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'useState') {
          const first = node.name.elements[0];
          if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name) && Object.hasOwn(fixture, first.name.text)) {
            injected.add(first.name.text);
            return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
              ts.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments,
                [ts.factory.createCallExpression(ts.factory.createIdentifier('__stateFixture'), undefined,
                  [ts.factory.createStringLiteral(first.name.text)])]));
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return source => ts.visitNode(source, visit);
    }] },
  }).outputText;
  assert.deepEqual([...injected].sort(), Object.keys(fixture).sort(), 'fixture must initialize actual named Settings states');
  const jsx = (type, props) => ({ type, props });
  const react = { useState: initial => {
    const stateName = initializedStateName;
    initializedStateName = undefined;
    return [typeof initial === 'function' ? initial() : initial, value => { if (stateName) stateUpdates[stateName] = value; if (stateName === 'error') errors.push(value); }];
  },
    useEffect() {}, useCallback: callback => callback, useMemo: factory => factory(), useRef: initial => ({ current: initial }) };
  const browser = { location: { href: 'https://example.invalid/dashboard/settings' } };
  const overrides = {
    '@/lib/native-companion': { nativeBillingActionBlocked: () => false },
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/link': 'link', 'qrcode.react': { QRCodeSVG: 'qr' }, 'lucide-react': require('lucide-react'),
    '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture_token' } } }) } }) },
    '@/components/whats-new-dot': { WhatsNewDot: 'dot', useIsFeatureNew: () => ({ isNew: false, dismiss() {} }) },
    '@/components/parents/proof-watermark-overlay': { ProofWatermarkOverlay: 'watermark' },
    '@/components/dashboard/stripe-standard-migration': { StripeStandardMigration: 'standard-migration' },
  };
  function load(file) {
    const exports = {};
    const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'exports', output)(name => {
      assert.ok(name in overrides, `unexpected dependency: ${name}`); return overrides[name];
    }, exports);
    return exports;
  }
  overrides['@/lib/order-fee-display'] = load('lib/order-fee-display.ts');
  overrides['@/lib/proof-watermark'] = load('lib/proof-watermark.ts');
  const exports = {};
  new Function('require', 'exports', '__stateFixture', 'fetch', 'window', compiled)(name => {
    assert.ok(name in overrides, `unexpected Settings dependency: ${name}`); return overrides[name];
  }, exports, name => { initializedStateName = name; return fixture[name]; }, async (url, options) => {
    assert.equal(url, stripeConnectUrl ? '/api/stripe/connect' : '/api/stripe/billing', 'no provider or unrelated request is permitted');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer fixture_token');
    assert.equal(options.credentials, 'include');
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true, url: stripeConnectUrl || 'https://example.invalid/billing-completed' }) };
  }, browser);
  const tree = exports.default();
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [node];
  }
  const saveButtons = nodes(tree).filter(node => node.type === 'button' && typeof node.props.onClick === 'function'
    && ['Update plan + keys', 'Start subscription', 'Activate paid subscription'].includes(node.props.children));
  assert.equal(saveButtons.length, 1, 'one actual rendered billing Save button');
  assert.equal(saveButtons[0].props.disabled, expectedPlanDisabled);
  const connectLabels=['Open Stripe Dashboard','Manage Stripe','Continue Stripe setup','Connect Stripe'];
  const connectButtons=nodes(tree).filter(node=>node.type==='button'&&nodes(node.props.children).some(child=>typeof child==='string'&&connectLabels.includes(child)));
  return { calls, errors, stateUpdates, browser, renderedNodes:nodes(tree), connectLabels:connectButtons.map(node=>nodes(node.props.children).find(child=>typeof child==='string'&&connectLabels.includes(child))),connect:()=>{assert.ok(connectButtons.length);return connectButtons[0].props.onClick();},save: () => saveButtons[0].props.onClick() };
}

test('existing V2 and legacy subscriptions post key-only changes without upgrading their base plan', async () => {
  for (const profile of ['gallery_v2', 'legacy']) {
    for (const subscriptionBillingInterval of ['month', 'year']) {
      for (const [extraDesktopKeys, desiredExtraDesktopKeys] of [[1, 3], [3, 0]]) {
        const h = harness({ profile, subscriptionBillingInterval, desiredBillingInterval: subscriptionBillingInterval,
          extraDesktopKeys, desiredExtraDesktopKeys });
        await h.save();
        assert.deepEqual(h.calls, [{ action: 'update_extra_keys', planCode: 'studio',
          billingInterval: subscriptionBillingInterval, extraDesktopKeys: desiredExtraDesktopKeys }]);
      }
    }
  }
});

test('real plan or cadence changes remain explicit plan updates', async () => {
  for (const state of [{ desiredPlanCode: 'core' }, { desiredBillingInterval: 'year' },
    { subscriptionPlanCode: 'core', desiredPlanCode: 'studio' }]) {
    const h = harness(state);
    await h.save();
    assert.equal(h.calls[0].action, 'update_plan');
    assert.equal(h.calls[0].planCode, state.desiredPlanCode ?? 'studio');
    assert.equal(h.calls[0].billingInterval, state.desiredBillingInterval ?? 'month');
    assert.equal(h.calls[0].extraDesktopKeys, state.desiredPlanCode === 'core' ? 0 : 3);
  }
});

test('an unknown saved plan never proves a key-only change', async () => {
  const h = harness({ subscriptionPlanCode: null });
  await h.save();
  assert.equal(h.calls[0].action, 'update_plan');
});

test('unknown current cadence blocks key-only Save instead of repricing an annual subscription to the default month', async () => {
  for (const profile of ['gallery_v2', 'legacy']) {
    const h = harness({ profile, subscriptionBillingInterval: null, desiredBillingInterval: 'month' });
    await h.save();
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.errors, ['Your current billing interval could not be verified. Refresh billing settings before changing photography keys.']);
  }
  const explicitPlanChange = harness({ subscriptionBillingInterval: null, desiredPlanCode: 'core' });
  await explicitPlanChange.save();
  assert.equal(explicitPlanChange.calls[0].action, 'update_plan');
});

test('a photographer without a subscription starts subscription checkout with chosen plan and keys', async () => {
  const h = harness({ stripeSubscriptionId: null, subscriptionPlanCode: null, subscriptionBillingInterval: null });
  await h.save();
  assert.deepEqual(h.calls, [{ action: 'subscribe', planCode: 'studio', billingInterval: 'month', extraDesktopKeys: 3 }]);
});

test('verified Standard management opens only its exact full Stripe dashboard URL',async()=>{const h=harness({stripeConnectUrl:'https://dashboard.stripe.com/'});assert.ok(h.connectLabels.every(label=>label==='Open Stripe Dashboard'));await h.connect();assert.equal(h.browser.location.href,'https://dashboard.stripe.com/');assert.equal(h.calls.length,1);assert.ok(h.errors.every(error=>error===null));});
test('pending Standard and existing Express continue their authenticated Stripe onboarding flow',async()=>{for(const state of [{connectReadyForPayments:false,stripePendingAccountId:'acct_pending'},{stripeAccountType:'express',stripeDashboardType:'express'}]){const h=harness({stripeConnectUrl:'https://connect.stripe.com/setup/s/example',...state});assert.ok(h.connectLabels.every(label=>label===('stripePendingAccountId'in state?'Continue Stripe setup':'Manage Stripe')));await h.connect();assert.equal(h.browser.location.href,'https://connect.stripe.com/setup/s/example');}});
test('actual Settings Connect action rejects arbitrary URLs, fake Stripe hosts and unexpected dashboard paths',async()=>{for(const stripeConnectUrl of ['https://attacker.example/','javascript:alert(1)','https://connect.stripe.com.attacker.example/setup','https://attacker@dashboard.stripe.com/','http://connect.stripe.com/setup','https://dashboard.stripe.com/invoices','https://dashboard.stripe.com/?redirect=attacker']){const h=harness({stripeConnectUrl});await h.connect();assert.equal(h.browser.location.href,'https://example.invalid/dashboard/settings');assert.ok(h.errors.some(error=>/destination could not be verified/.test(error||'')));}});


test('unknown saved business country disables actual new-subscription Save and independently rejects its click',async()=>{
 const h=harness({profile:'gallery_v3',stripeSubscriptionId:null,subscriptionPlanCode:null,subscriptionCountryRequired:true,expectedPlanDisabled:true});
 await h.save();assert.deepEqual(h.calls,[]);assert.ok(h.errors.some(x=>/Select and save your business country/.test(x)));
});
test('saved subscription currency is distinct from customer sales and CAD credit pack displays',()=>{
 const plans=Object.values(getPlanDefinitions('gallery_v3'));
 for(const subscriptionCurrency of ['usd','aud','gbp']){
  const h=harness({profile:'gallery_v3',subscriptionCurrency,billingCurrency:'usd',creditCurrency:'cad',billingCatalog:{pricingProfile:'gallery_v3',currency:subscriptionCurrency,plans,annualDiscountPercent:null,extraDesktopKeyMonthlyCents:5500,extraDesktopKeyAnnualCents:59400,creditPacks:[{code:'background_credits_250',credits:250,priceCents:4000,label:'Synthetic pack'}]}});
  const text=h.renderedNodes.filter(x=>typeof x==='string'||typeof x==='number').join(' ').replace(/\s+/g,' ');
  assert.match(text,new RegExp(`subscription is billed separately in ${subscriptionCurrency.toUpperCase()}`));
  assert.ok(text.includes('250 monthly credits for $40.00'),'CAD credit price remains $40 rather than being relabeled');
  assert.match(text,/All credit packs are billed in CAD/);
  const comparisons=h.renderedNodes.filter(n=>typeof n.type==='function'&&n.type.name==='PlanCompareCard');
  assert.equal(comparisons.length,3);assert.ok(comparisons.every(n=>n.props.currency===subscriptionCurrency));
 }
});
test('an existing CAD subscription in a US-sales studio keeps CAD plan and extra-key intent',async()=>{
 const h=harness({profile:'gallery_v3',subscriptionCurrency:'cad',billingCurrency:'usd',businessCountry:'US'});await h.save();assert.equal(h.calls[0].action,'update_extra_keys');assert.ok(!Object.hasOwn(h.calls[0],'currency'));assert.ok(!Object.hasOwn(h.calls[0],'country'));
});


test('unverified existing subscription currency blocks actual plan and key mutations without blocking CAD credit purchases',async()=>{
 const h=harness({profile:'gallery_v3',subscriptionCurrency:null,subscriptionCurrencyUnavailable:true,subscriptionCountryRequired:false,expectedPlanDisabled:true,billingCatalog:{pricingProfile:'gallery_v3',currency:'cad',plans:Object.values(getPlanDefinitions('gallery_v3')),annualDiscountPercent:null,extraDesktopKeyMonthlyCents:5500,extraDesktopKeyAnnualCents:59400,creditPacks:[{code:'background_credits_250',credits:250,priceCents:4000,label:'Synthetic pack'}]}});
 await h.save();assert.deepEqual(h.calls,[]);assert.ok(h.errors.some(x=>/subscription currency could not be verified/.test(x)));
 const nodes=h.renderedNodes;const comparisons=nodes.filter(n=>typeof n.type==='function'&&n.type.name==='PlanCompareCard');assert.ok(comparisons.every(n=>n.props.currencyAvailable===false));
 assert.ok(nodes.some(n=>typeof n==='string'&&n==='Currency needs verification'));
 const portal=nodes.find(n=>n.type==='button'&&n.props.children==='Open billing portal');assert.equal(portal.props.disabled,false);
 const credits=nodes.find(n=>n.type==='button'&&n.props.children==='Buy credits');assert.equal(credits.props.disabled,false);await credits.props.onClick();assert.deepEqual(h.calls,[{action:'buy_credits',packCode:'background_credits_250'}]);
});


test('Settings offers Australian and UK legal countries and defaults unsaved sales currency without overriding an explicit selection',()=>{
 for(const [country,currency]of [['CA','cad'],['US','usd'],['AU','aud'],['GB','gbp']]){
  for(const salesCurrencyConfigured of [false,true]){
   const h=harness({businessCountry:'',billingCurrency:'eur',salesCurrencyConfigured});const select=h.renderedNodes.find(node=>node.type==='select'&&node.props['aria-label']==='Business country');assert.ok(select);
   const options=select.props.children.filter(node=>node?.type==='option');assert.ok(options.some(option=>option.props.value===country));select.props.onChange({target:{value:country}});assert.equal(h.stateUpdates.businessCountry,country);
   assert.equal(h.stateUpdates.billingCurrency,salesCurrencyConfigured?undefined:currency);
  }
 }
});
