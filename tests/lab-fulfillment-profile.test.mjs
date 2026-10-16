import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

// Fictional labs, SKUs, source IDs and quantities only. No account, DB or printer.
function load(file,dependencies={}) { const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText,exports={};new Function('require','exports',code)(name=>{ assert(name in dependencies,'Profile planning must not load provider, renderer or database dependency '+name);return dependencies[name]; },exports);return exports; }
const api=load('lib/labs/fulfillment-profile.ts',{ zod:{ z },'../lab-directory':load('lib/lab-directory.ts'),'./money':load('lib/labs/money.ts') });
const { parseFulfillmentProfile,parseFulfillmentPlanRequest,resolveFulfillmentCapabilities }=api;
const clone=value=>structuredClone(value);
const LABS={
  CA:{ labId:'11111111-1111-4111-8111-111111111111',marketCountryCode:'CA',currency:'CAD',location:{ countryCode:'CA',city:'SYNTHETIC North City',timeZone:'America/Toronto' },unit:'in',sizes:{ large:[8,10],small:[5,7],pair:[10,7] } },
  GB:{ labId:'22222222-2222-4222-8222-222222222222',marketCountryCode:'GB',currency:'GBP',location:{ countryCode:'GB',city:'SYNTHETIC Island City',timeZone:'Europe/London' },unit:'mm',sizes:{ large:[203.2,254],small:[127,177.8],pair:[254,177.8] } },
  JP:{ labId:'33333333-3333-4333-8333-333333333333',marketCountryCode:'JP',currency:'JPY',location:{ countryCode:'JP',city:'SYNTHETIC Pacific City',timeZone:'Asia/Tokyo' },unit:'mm',sizes:{ large:[203.2,254],small:[127,177.8],pair:[254,177.8] } },
};
const size=(lab,kind)=>({ unit:lab.unit,width:lab.sizes[kind][0],height:lab.sizes[kind][1] });
function profile(country='CA') {
  const lab=LABS[country];return { version:1,labId:lab.labId,marketCountryCode:lab.marketCountryCode,revision:7,location:{ ...lab.location },currency:lab.currency,transport:{ kind:'manual_download',state:'configured' },capabilities:{ inputModes:['individual','composite'],labCropping:true,labColourCorrection:true,deliveryModes:['pickup','ship_to_studio','ship_to_client'],deliveryCountries:[country] },products:[{ productId:'SYNTHETIC-large',sku:'SYNTHETIC-'+country+'-8x10',finishedSize:size(lab,'large'),inputModes:['individual','composite'],paperIds:['SYNTHETIC-large-paper'] },{ productId:'SYNTHETIC-small',sku:'SYNTHETIC-'+country+'-5x7',finishedSize:size(lab,'small'),inputModes:['individual','composite'],paperIds:['SYNTHETIC-small-paper','SYNTHETIC-pair-paper'] }],papers:[{ paperId:'SYNTHETIC-large-paper',size:size(lab,'large'),dpi:300,colorSpace:'sRGB' },{ paperId:'SYNTHETIC-small-paper',size:size(lab,'small'),dpi:300,colorSpace:'sRGB' },{ paperId:'SYNTHETIC-pair-paper',size:size(lab,'pair'),dpi:300,colorSpace:'sRGB' }] };
}
function request(country='CA',mode='individual') {
  const lab=LABS[country],lines=[['large','large','SYNTHETIC-source-large'],['small-a','small','SYNTHETIC-source-a'],['small-b','small','SYNTHETIC-source-b']].map(([lineId,kind,sourceAssetId])=>({ lineId,productId:'SYNTHETIC-'+kind,sku:'SYNTHETIC-'+country+'-'+(kind==='large'?'8x10':'5x7'),finishedSize:size(lab,kind),quantity:3,sourceAssetId }));
  const cell=(lineId,x=0)=>({ lineId,sourceAssetId:lines.find(line=>line.lineId===lineId).sourceAssetId,x,y:0,unit:lab.unit,rotation:0 });
  const output=(outputId,paperId,cells)=>({ outputId,paperId,dpi:300,colorSpace:'sRGB',copies:3,cells });
  return { labId:lab.labId,marketCountryCode:lab.marketCountryCode,profileRevision:7,currency:lab.currency,inputMode:mode,labCropping:false,labColourCorrection:false,delivery:{ mode:'ship_to_client',countryCode:country },lines,outputs:mode==='individual'?[output('SYNTHETIC-large-output','SYNTHETIC-large-paper',[cell('large')]),output('SYNTHETIC-small-a-output','SYNTHETIC-small-paper',[cell('small-a')]),output('SYNTHETIC-small-b-output','SYNTHETIC-small-paper',[cell('small-b')])]:[output('SYNTHETIC-large-output','SYNTHETIC-large-paper',[cell('large')]),output('SYNTHETIC-pair-output','SYNTHETIC-pair-paper',[cell('small-a'),cell('small-b',lab.sizes.small[0])])] };
}
function held(p,r,message='Unsupported details must remain held') {
  let result;assert.doesNotThrow(()=>{ result=resolveFulfillmentCapabilities(p,r); },message);assert.equal(result.supported,false,message);assert.equal(result.plan,null,message);assert(result.reasons.length>0,message);assert(result.reasons.every(reason=>typeof reason==='string'&&reason.length>0),message);return result;
}
function supported(p,r) { const result=resolveFulfillmentCapabilities(p,r);assert.equal(result.supported,true,JSON.stringify(result.reasons));assert.deepEqual(result.reasons,[]);assert(result.plan);return result; }

test('fictional Canadian, British and Japanese labs keep their exact currencies, units and declared catalogues',()=>{
  for (const country of ['CA','GB','JP']) { const p=profile(country),r=request(country);assert.deepEqual(parseFulfillmentProfile(p),p);const result=supported(p,r);assert.equal(result.plan.currency,LABS[country].currency);assert.equal(result.plan.currencyMinorUnits,country==='JP'?0:2);assert.deepEqual(result.plan.lines,r.lines);assert.deepEqual(result.plan.outputs,r.outputs);supported(p,request(country,'composite')); }
});

test('lab, market and profile revision form an exact identity rather than a default substitution',()=>{
  const p=profile(),r=request();
  for (const change of [value=>{ value.labId=LABS.GB.labId; },value=>{ value.marketCountryCode='GB'; },value=>{ value.profileRevision=6; },value=>{ value.profileRevision=8; },value=>{ value.profileRevision='7'; }]) { const changed=clone(r);change(changed);held(p,changed); }
  assert(held(p,{ ...r,labId:LABS.GB.labId }).reasons.includes('profile_scope_mismatch'),'A syntactically valid other lab ID must fail the scope check');
  for (const country of ['GB','JP']) held(profile(country),r,'A similarly sized catalogue at another lab cannot receive this request');
  const changed=clone(p);changed.revision=8;held(changed,r,'Editing the available profile cannot rewrite an existing request revision');
});

test('product identity requires exact SKU, currency, dimensions and supported paper with no nearest-size fallback',()=>{
  const p=profile('GB'),r=request('GB');
  const mutations=[value=>{ value.currency='CAD'; },value=>{ value.lines[0].productId='SYNTHETIC-unknown'; },value=>{ value.lines[0].sku='SYNTHETIC-GB-8x10-nearly'; },value=>{ value.lines[0].finishedSize.width=203.199; },value=>{ value.lines[0].finishedSize.height=253.999; },value=>{ value.lines[0].finishedSize={ unit:'in',width:10,height:8 }; },value=>{ value.outputs[0].paperId='SYNTHETIC-unknown-paper'; },value=>{ value.outputs[0].paperId='SYNTHETIC-small-paper'; },value=>{ value.outputs[0].dpi=299; },value=>{ value.outputs[0].colorSpace='DisplayP3'; }];
  for (const change of mutations) { const changed=clone(r);change(changed);held(p,changed); }
  const lowerCase=clone(r);lowerCase.lines[0].sku=lowerCase.lines[0].sku.toLowerCase();assert(held(p,lowerCase).reasons.includes('sku_mismatch'),'Case-sensitive SKU identity cannot be normalized to another product');
  const inches=clone(r);inches.lines[0].finishedSize={ unit:'in',width:8,height:10 };inches.lines[1].finishedSize={ unit:'in',width:5,height:7 };inches.lines[2].finishedSize={ unit:'in',width:5,height:7 };supported(p,inches);
});

test('delivery options depend on the chosen market and explicit receiving countries rather than lab location guesses',()=>{
  const p=profile(),r=request();for (const mode of ['pickup','ship_to_studio','ship_to_client']) supported(p,{ ...r,delivery:{ mode,countryCode:'CA' } });
  held(p,{ ...r,delivery:{ mode:'ship_to_client',countryCode:'US' } });const crossBorder=clone(p);crossBorder.capabilities.deliveryCountries.push('US');supported(crossBorder,{ ...r,delivery:{ mode:'ship_to_client',countryCode:'US' } });held(crossBorder,{ ...r,delivery:{ mode:'pickup',countryCode:'US' } });
  const shippingOnly=clone(p);shippingOnly.capabilities.deliveryModes=['ship_to_studio'];held(shippingOnly,{ ...r,delivery:{ mode:'pickup',countryCode:'CA' } });held(shippingOnly,r);supported(shippingOnly,{ ...r,delivery:{ mode:'ship_to_studio',countryCode:'CA' } });
  const sameLabAnotherMarket=clone(p);sameLabAnotherMarket.marketCountryCode='GB';sameLabAnotherMarket.currency='GBP';sameLabAnotherMarket.capabilities.deliveryCountries=['GB'];held(sameLabAnotherMarket,r);supported(sameLabAnotherMarket,{ ...r,marketCountryCode:'GB',currency:'GBP',delivery:{ mode:'ship_to_client',countryCode:'GB' } });
});

test('services and transport are explicit and cannot authorize API, hot-folder or Windows execution',()=>{
  const p=profile(),r=request();supported(p,{ ...r,labCropping:true,labColourCorrection:true });
  for (const service of ['labCropping','labColourCorrection']) { const limited=clone(p);limited.capabilities[service]=false;held(limited,{ ...r,[service]:true });supported(limited,r); }
  for (const kind of ['api','hot_folder','windows_helper']) for (const state of ['configured','unverified']) held({ ...p,transport:{ kind,state } },r,'New generic transport must not invoke or borrow the existing fixed Windows helper');
  held({ ...p,transport:{ kind:'manual_download',state:'unverified' } },r);held(p,{ ...r,retouchFaces:true });held({ ...p,capabilities:{ ...p.capabilities,retouchFaces:true } },r);
});

test('individual 5x7 outputs and a 10x7 pair are different declared capabilities with exact cell placement',()=>{
  const p=profile(),separate=request(),pair=request('CA','composite');supported(p,separate);supported(p,pair);
  const individualOnly=clone(p);individualOnly.capabilities.inputModes=['individual'];individualOnly.products.forEach(product=>{ product.inputModes=['individual']; });supported(individualOnly,separate);held(individualOnly,pair);
  held(p,{ ...pair,inputMode:'individual' });
  const unavailablePaper=clone(p);unavailablePaper.products[1].paperIds=['SYNTHETIC-small-paper'];held(unavailablePaper,pair);supported(unavailablePaper,separate);
  for (const change of [value=>{ value.outputs[1].cells[1].x=4.999; },value=>{ value.outputs[1].cells[1].x=5.001; },value=>{ value.outputs[1].cells[1].y=.001; },value=>{ value.outputs[1].cells[1].rotation=90; },value=>{ value.outputs[1].cells[1].x=-1; }]) { const changed=clone(pair);change(changed);held(p,changed); }
  const metric=clone(pair);metric.outputs[1].cells[1].x=127;metric.outputs[1].cells[1].unit='mm';supported(p,metric);
});

test('quantities, source identity and every selected line remain exact across output packing',()=>{
  const p=profile(),r=request('CA','composite');
  for (const change of [value=>{ value.lines[0].quantity=0; },value=>{ value.lines[0].quantity=1.5; },value=>{ value.outputs[0].copies=2; },value=>{ value.outputs[1].copies=4; },value=>{ value.outputs[1].cells.pop(); },value=>{ value.outputs[1].cells[1].sourceAssetId='SYNTHETIC-different-photo'; },value=>{ value.outputs[1].cells[1].lineId='SYNTHETIC-unknown-line'; },value=>{ value.outputs[1].cells.push(clone(value.outputs[1].cells[0])); },value=>{ value.outputs.push(clone(value.outputs[0])); },value=>{ value.lines[1].lineId=value.lines[0].lineId; }]) { const changed=clone(r);change(changed);held(p,changed); }
  const repeatedSource=clone(r);repeatedSource.lines[2].sourceAssetId=repeatedSource.lines[1].sourceAssetId;repeatedSource.outputs[1].cells[1].sourceAssetId=repeatedSource.lines[1].sourceAssetId;supported(p,repeatedSource);
  const split=clone(r);split.outputs[0].copies=2;split.outputs.push({ ...clone(split.outputs[0]),outputId:'SYNTHETIC-final-large-copy',copies:1 });supported(p,split);
  const maximum=clone(r);maximum.lines.forEach(line=>{ line.quantity=1000; });maximum.outputs.forEach(output=>{ output.copies=1000; });supported(p,maximum);maximum.lines[0].quantity=1001;maximum.outputs[0].copies=1001;held(p,maximum);
});

function frozenTree(value) { if (value&&typeof value==='object') { assert(Object.isFrozen(value),'Every snapshot object and array must be frozen');for (const child of Object.values(value)) frozenTree(child); } }
test('every compatible result is a deeply frozen defensive TEST snapshot with no operational or payment permission',()=>{
  for (const country of ['CA','GB','JP']) for (const mode of ['individual','composite']) {
    const p=profile(country),r=request(country,mode),originalProfile=clone(p),originalRequest=clone(r),plan=supported(p,r).plan,before=clone(plan);
    assert.deepEqual({ testOnly:plan.testOnly,printAllowed:plan.printAllowed,paymentAllowed:plan.paymentAllowed,operationallyAuthorized:plan.operationallyAuthorized },{ testOnly:true,printAllowed:false,paymentAllowed:false,operationallyAuthorized:false });
    assert.equal(plan.labId,p.labId);assert.equal(plan.marketCountryCode,p.marketCountryCode);assert.equal(plan.revision,7);assert.equal(plan.profileVersion,1);assert.deepEqual(plan.profile,originalProfile);assert.deepEqual(plan.request,originalRequest);frozenTree(plan);
    assert.notStrictEqual(plan.profile,p);assert.notStrictEqual(plan.profile.products,p.products);assert.notStrictEqual(plan.request,r);assert.notStrictEqual(plan.lines,r.lines);assert.notStrictEqual(plan.outputs[0].cells,r.outputs[0].cells);
    assert.equal(Object.isFrozen(p),false);assert.equal(Object.isFrozen(r),false);p.revision=8;p.products[0].sku='SYNTHETIC replacement SKU';p.papers[0].size.width=1;p.capabilities.deliveryCountries.length=0;r.lines[0].sourceAssetId='SYNTHETIC replacement photo';r.lines[0].quantity=100;r.outputs[0].copies=100;r.outputs[0].cells[0].x=1;
    assert.deepEqual(plan,before,'Later catalogue, source and quantity edits cannot alter the frozen test plan');assert.throws(()=>{ plan.printAllowed=true; },TypeError);assert.throws(()=>{ plan.lines[0].sourceAssetId='replacement'; },TypeError);assert.throws(()=>plan.outputs.push(clone(plan.outputs[0])),TypeError);
  }
});

test('explicit quarter-turn placement fits only the declared paper and never changes the finished product dimensions',()=>{
  const p=profile(),r=request();p.papers.push({ paperId:'SYNTHETIC-landscape-large-paper',size:{ unit:'in',width:10,height:8 },dpi:300,colorSpace:'sRGB' });p.products[0].paperIds.push('SYNTHETIC-landscape-large-paper');r.outputs[0].paperId='SYNTHETIC-landscape-large-paper';r.outputs[0].cells[0].rotation=90;
  const plan=supported(p,r).plan;assert.deepEqual(plan.lines[0].finishedSize,{ unit:'in',width:8,height:10 });assert.equal(plan.outputs[0].cells[0].rotation,90);held(p,{ ...r,outputs:r.outputs.map((output,index)=>index?output:{ ...output,cells:[{ ...output.cells[0],rotation:0 }] }) });
  const pair=request('CA','composite'),larger=profile();larger.papers[2].size.width=10.001;pair.outputs[1].cells[1].x=5.001;supported(larger,pair);held(profile(),pair,'No extra trim area is inferred when a cell exceeds the configured paper');
});

test('an arbitrary eight-line catalogue request can contain additional print sizes without any three-print package assumption',()=>{
  const p=profile(),r=request();p.products.push({ productId:'SYNTHETIC-postcard',sku:'SYNTHETIC-CA-4x6',finishedSize:{ unit:'in',width:4,height:6 },inputModes:['individual'],paperIds:['SYNTHETIC-postcard-paper'] });p.papers.push({ paperId:'SYNTHETIC-postcard-paper',size:{ unit:'in',width:4,height:6 },dpi:300,colorSpace:'sRGB' });
  r.lines=Array.from({ length:8 },(_,index)=>{ const product=p.products[index%2?2:1];return { lineId:'SYNTHETIC-line-'+index,productId:product.productId,sku:product.sku,finishedSize:clone(product.finishedSize),quantity:index+1,sourceAssetId:'SYNTHETIC-independent-photo-'+index }; });
  r.outputs=r.lines.map((line,index)=>({ outputId:'SYNTHETIC-paper-output-'+index,paperId:index%2?'SYNTHETIC-postcard-paper':'SYNTHETIC-small-paper',dpi:300,colorSpace:'sRGB',copies:line.quantity,cells:[{ lineId:line.lineId,sourceAssetId:line.sourceAssetId,x:0,y:0,unit:'in',rotation:0 }] }));
  const plan=supported(p,r).plan;assert.equal(plan.lines.length,8);assert.equal(plan.outputs.length,8);assert.deepEqual(plan.lines,r.lines);assert.deepEqual(plan.outputs,r.outputs);assert.deepEqual(plan.lines.map(line=>line.quantity),[1,2,3,4,5,6,7,8]);assert(plan.lines.some(line=>line.finishedSize.width===4&&line.finishedSize.height===6));assert.equal(plan.printAllowed,false);assert.equal(plan.paymentAllowed,false);
});

test('strict declared catalogues reject duplicate identities, unknown references and undeclared options',()=>{
  const p=profile(),r=request(),mutations=[value=>{ value.products[1].productId=value.products[0].productId; },value=>{ value.products[1].sku=value.products[0].sku; },value=>{ value.papers[1].paperId=value.papers[0].paperId; },value=>{ value.products[0].paperIds=['SYNTHETIC-missing-paper']; },value=>{ value.products[0].inputModes=['composite'];value.capabilities.inputModes=['individual']; },value=>{ value.products[0].inputModes=['individual','individual']; },value=>{ value.capabilities.deliveryCountries=['CA','CA']; },value=>{ value.capabilities.deliveryModes=['pickup','pickup']; },value=>{ value.transport.endpoint='https://SYNTHETIC.example.test/orders'; },value=>{ value.location.timeZone='SYNTHETIC/Never'; },value=>{ value.currency='ZZZ'; },value=>{ value.marketCountryCode='ZZ'; },value=>{ value.products[0].sku=' SYNTHETIC padded SKU '; },value=>{ value.products[0].sku='SYNTHETIC\u0000control'; }];
  for (const change of mutations) { const changed=clone(p);change(changed);assert.throws(()=>parseFulfillmentProfile(changed));held(changed,r); }
  const dangerous=JSON.parse(JSON.stringify(r));Object.defineProperty(dangerous,'__proto__',{ value:{ printAllowed:true },enumerable:true });held(p,dangerous);
  for (const object of [{ ...p,printAllowed:true },{ ...p,paymentAllowed:true },{ ...p,operationallyAuthorized:true }]) { assert.throws(()=>parseFulfillmentProfile(object));held(object,r); }
});

test('precision and preflight bounds reject microscopic substitutions and excessive nested cells before planning',()=>{
  const p=profile('GB'),r=request('GB','composite');
  for (const width of [203.200000000001,203.20001,1e-20]) { const changed=clone(p);changed.products[0].finishedSize.width=width;assert.throws(()=>parseFulfillmentProfile(changed));held(changed,r); }
  for (const x of [127.000000000001,127.00001,NaN,Infinity,-.001]) { const changed=clone(r);changed.outputs[1].cells[1].x=x;assert.throws(()=>parseFulfillmentPlanRequest(changed));held(p,changed); }
  for (const change of [value=>{ value.outputs[0].cells=Array.from({ length:101 },()=>clone(value.outputs[0].cells[0])); },value=>{ value.outputs=Array.from({ length:11 },(_,index)=>({ ...clone(value.outputs[0]),outputId:'SYNTHETIC-'+index,cells:Array.from({ length:100 },()=>clone(value.outputs[0].cells[0])) })); },value=>{ value.outputs=Array.from({ length:201 },(_,index)=>({ ...clone(value.outputs[0]),outputId:'SYNTHETIC-'+index })); },value=>{ value.lines[0].sourceAssetId='../SYNTHETIC-source.jpg'; },value=>{ value.lines[0].sourceAssetId='SYNTHETIC\nsource'; },value=>{ value.outputs[0].cells[0].rotation=45; }]) { const changed=clone(r);change(changed);assert.throws(()=>parseFulfillmentPlanRequest(changed));held(p,changed); }
});

test('malformed or oversized untrusted profile and request inputs fail closed without introducing a plan',()=>{
  const p=profile(),r=request();
  for (const value of [null,undefined,true,0,NaN,'{}',[],{}, { ...p,version:2 },{ ...p,revision:0 },{ ...p,location:null },{ ...p,products:[] },{ ...p,papers:[] },{ ...p,location:{ ...p.location,city:'X'.repeat(10000) } },{ ...p,products:Array.from({ length:10001 },()=>clone(p.products[0])) }]) { assert.throws(()=>parseFulfillmentProfile(value));held(value,r); }
  for (const value of [null,undefined,false,0,NaN,'{}',[],{}, { ...r,lines:[] },{ ...r,outputs:[] },{ ...r,lines:Array.from({ length:10001 },()=>clone(r.lines[0])) },{ ...r,outputs:Array.from({ length:10001 },()=>clone(r.outputs[0])) },{ ...r,lines:r.lines.map((line,index)=>index?line:{ ...line,sourceAssetId:'X'.repeat(10000) }) },{ ...r,printAllowed:true },{ ...r,retailCents:1 }]) held(p,value);
  for (const dimensions of [{ unit:'cm',width:20.32,height:25.4 },{ unit:'mm',width:0,height:254 },{ unit:'mm',width:203.2001,height:254 },{ unit:'mm',width:Infinity,height:254 }]) { const changed=clone(p);changed.products[0].finishedSize=dimensions;assert.throws(()=>parseFulfillmentProfile(changed));held(changed,r); }
});
