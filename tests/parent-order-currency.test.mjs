import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {harness, id, projectId} from './helpers/event-gallery-harness.mjs';

const require = createRequire(import.meta.url), root = new URL('../', import.meta.url);
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function load(file, overrides = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports={};cache.set(file,exports);
  new Function('require','exports',compile(readFileSync(new URL(file,root),'utf8')))(name => {
    if (Object.hasOwn(overrides,name)) return overrides[name];
    if(name.startsWith('@/') || name.startsWith('.')) {
      const base=name.startsWith('@/')?name.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
      const target=['.ts','.tsx'].map(ext=>base+ext).find(target=>existsSync(new URL(target,root)));
      assert.ok(target,`missing module ${name}`);return load(target,overrides,cache);
    }
    return require(name);
  },exports);return exports;
}
const {formatOrderMoney}=load('lib/order-money.ts');
const currencies=load('lib/order-currency.ts').SUPPORTED_ORDER_CURRENCIES;
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#xA0;/gi,' ').replace(/\s+/g,' ').trim();

for (const currency of currencies) {
  test(`school and event contexts use trusted ${currency} without converting nominal prices`,async()=>{
    const fixture=harness({overrides:{
      '@/lib/school-order-media':{loadScopedSchoolCompositeMedia:async()=>[]},
      '@/lib/storage-folder':{buildSchoolCandidateFolders:()=>[],loadFolderMediaRows:async()=>[],loadNoBgUrlMapForMediaRows:async()=>({})},
      '@/lib/backdrop-media-references':{signBackdropRows:async rows=>rows},
    }});
    const owner=id(80),otherOwner=id(81),school=id(82),student=id(83),pkg=id(84);
    fixture.tables.photographers.push({id:owner,subscription_status:'active',billing_currency:currency},{id:otherOwner,subscription_status:'active',billing_currency:'usd'});
    fixture.tables.projects[0].photographer_id=owner;
    fixture.tables.schools.push({id:school,school_name:'Fixture school',photographer_id:owner,status:'active'});
    fixture.tables.students.push({id:student,school_id:school,first_name:'Fixture',pin:'student-pin',class_id:null,photo_url:null});
    fixture.tables.packages.push({id:pkg,photographer_id:owner,active:true,name:'Fixture package',price_cents:2500},{id:id(85),photographer_id:otherOwner,active:true,name:'Foreign package',price_cents:9999});
    for (const [route,body] of [
      ['app/api/portal/event-gallery-context/route.ts',fixture.body({projectId,billingCurrency:'usd'})],
      ['app/api/portal/gallery-context/route.ts',{schoolId:school,pin:'student-pin',email:'viewer@example.test',billingCurrency:'usd'}],
    ]) {
      const result=await fixture.post(route,body);
      assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.orderCurrency,currency);
      assert.equal(result.body.packages.length,1);assert.equal(result.body.packages[0].price_cents,2500);
      assert.equal(result.body.photographerId,owner);
    }
  });
}

test('gallery contexts reject unsupported profile currency and preserve missing legacy CAD fallback',async()=>{
  for (const currency of ['jpy',null]) {
    const fixture=harness();const owner=id(80);
    fixture.tables.photographers.push({id:owner,subscription_status:'active',billing_currency:currency});fixture.tables.projects[0].photographer_id=owner;
    const result=await fixture.post('app/api/portal/event-gallery-context/route.ts');
    assert.equal(result.status,currency===null?200:409);assert.equal(result.body.orderCurrency,currency===null?'cad':undefined);
  }
});

function initializedPage(file, fixture, overrides={}) {
  const source=readFileSync(new URL(file,root),'utf8');const injected=new Set();
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},transformers:{before:[context=>{
    const visit=node=>{
      if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&ts.isCallExpression(node.initializer)&&ts.isIdentifier(node.initializer.expression)&&node.initializer.expression.text==='useState') {
        const first=node.name.elements[0];if(first&&ts.isBindingElement(first)&&ts.isIdentifier(first.name)&&Object.hasOwn(fixture,first.name.text)) {
          injected.add(first.name.text);return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.factory.updateCallExpression(node.initializer,node.initializer.expression,node.initializer.typeArguments,[ts.factory.createCallExpression(ts.factory.createIdentifier('__fixture'),undefined,[ts.factory.createStringLiteral(first.name.text)])]));
        }
      }
      return ts.visitEachChild(node,visit,context);
    };return source=>ts.visitNode(source,visit);
  }]}}).outputText;
  assert.deepEqual([...injected].sort(),Object.keys(fixture).sort());
  const modules={react:React,'react/jsx-runtime':jsxRuntime,'@/lib/supabase/client':{createClient:()=>({})},...overrides};
  const cache=new Map(),exports={};
  new Function('require','exports','__fixture',code)(name=>{
    if(Object.hasOwn(modules,name))return modules[name];
    if(name.startsWith('@/components/'))return new Proxy({__esModule:true},{get:(_obj,key)=>key==='__esModule'?true:()=>null});
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',modules,cache);
    return require(name);
  },exports,name=>fixture[name]);
  return props=>renderToStaticMarkup(React.createElement(exports.default,props));
}

const school=id(82),student={id:id(83),first_name:'Fixture',last_name:null,school_id:school};
const pkg={id:id(84),name:'Fixture package',price_cents:2500,items:['8x10'],category:'physical',description:null};
const item={id:'fixture-item',packageId:pkg.id,packageName:pkg.name,category:'physical',quantity:1,slots:[],packageSubtotalCents:2500,backdropAddOnCents:300,lineTotalCents:2800,selectedImageUrl:null};
const defaultSettings=load('lib/event-gallery-settings.ts').defaultEventGallerySettings;
const shippingSettings={...defaultSettings,extras:{...defaultSettings.extras,shippingEnabled:true}};
const navigation={'next/navigation':{useParams:()=>({pin:'student-pin'}),useRouter:()=>({}),useSearchParams:()=>new URLSearchParams({school,email:'viewer@example.test'})}};
for (const currency of ['eur','gbp','amd','usd']) {
  test(`actual parent basket renders ${currency} subtotal, backdrop, shipping and total`,()=>{
    const page=initializedPage('app/parents/[pin]/page.tsx',{loading:false,student,schoolName:'Fixture school',photographerId:id(80),orderCurrency:currency,packages:[pkg],cartItems:[item],drawerOpen:true,drawerView:'checkout',gallerySettings:shippingSettings,lateOrderPolicy:{orderDueDate:'2000-01-01',shippingFeeCents:500,lateHandlingFeePercent:0},deliveryMethod:'shipping'},navigation);
    const html=text(page());
    for(const cents of [2500,300,500,3300])assert.ok(html.includes(formatOrderMoney(cents,currency).replace(/\s+/g,' ')),`missing ${currency} ${cents}: ${html.slice(-2500)}`);
    assert.doesNotMatch(html,/\$25\.00|\$3\.00|\$5\.00|\$33\.00/);
  });
}

test('actual order history preserves each saved currency and separates mixed-currency totals',()=>{
  const rows=[['eur',2500],['eur',500],['gbp',1200]].map(([currency,totalCents],index)=>({id:id(90+index),shortId:'TEST',status:'paid',totalCents,currency,createdAt:null,paidAt:null,packageName:'Saved package',items:[],cartSnapshot:null,schoolId:school,projectId:null,studentId:student.id,orderGroupId:null,studentName:'Fixture'}));
  const page=initializedPage('components/parents/orders-history-panel.tsx',{loading:false,orders:rows});
  const html=text(page({pin:'test',email:'viewer@example.test',tone:{text:'#000',mutedText:'#666',accent:'#000',border:'#ddd',surface:'#fff'}}));
  for(const [currency,cents] of [['eur',2500],['eur',500],['gbp',1200],['eur',3000]])assert.ok(html.includes(formatOrderMoney(cents,currency).replace(/\s+/g,' ')));
  assert.ok(html.includes('EUR 30.00 + GBP 12.00 total'));
  assert.doesNotMatch(html,/42\.00 total|\$25\.00/);
});

test('actual gallery product picker and premium backdrop confirmation display studio currency',()=>{
  const premium={id:id(100),name:'Premium backdrop',image_url:'https://fixture.test/backdrop.jpg',thumbnail_url:null,tier:'premium',price_cents:300};
  const page=initializedPage('app/parents/[pin]/page.tsx',{loading:false,student,schoolName:'Fixture school',photographerId:id(80),orderCurrency:'eur',packages:[pkg],drawerOpen:true,drawerView:'product-select',showPremiumModal:true,premiumTarget:premium},navigation);
  const html=text(page());
  assert.ok(html.includes('EUR 25.00'),'package price shows the selected studio currency');
  assert.ok(html.includes('Unlock for EUR 3.00'),'premium add-on confirmation shows the same studio currency');
  assert.doesNotMatch(html,/\$25\.00|\$3\.00/);
});
