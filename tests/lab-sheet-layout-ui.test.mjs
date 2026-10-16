import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { z } from 'zod';

function load(file,deps={}) {
  const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{ fileName:file,compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX } }).outputText;
  const exports={}; new Function('require','exports',code)(name=>{ if (!(name in deps)) throw Error('Missing dependency '+name); return deps[name]; },exports); return exports;
}
const layouts=load('lib/labs/sheet-layouts.ts',{ zod:{ z } }),deps={ react:React,'react/jsx-runtime':jsxRuntime,'lucide-react':icons,'next/image':()=>null,'next/link':()=>null,'./sheet-crop-editor.module.css':{},'./sheet-layout-builder.module.css':{},'@/lib/labs/sheet-layouts':layouts,'@/lib/supabase/client':{ createClient(){ throw Error('Pure sheet tests cannot access accounts'); } },'./production-client':{} };
const crop=load('components/labs/sheet-crop-editor.tsx',deps),builder=load('components/labs/sheet-layout-builder.tsx',{ ...deps,'./sheet-crop-editor':crop });
function nodes(value) { if (!value || typeof value!=='object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value,...nodes(value.props?.children)]; }
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.map(text).join(''):value?.props?text(value.props.children):'';
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,actual+' != '+expected);
const photo={ id:'11111111-1111-4111-8111-111111111111',kind:'original',filename:'SYNTHETIC source.jpg',widthPixels:3000,heightPixels:4200,byteSize:1000,sha256:'a'.repeat(64),contentType:'image/jpeg' };
function document(patch={}) { return { paperId:'7x10',orientation:90,templateId:'two-5x7',copies:1,cells:['a','b'].map(id=>({ id,assetId:photo.id,crop:{ x:0,y:0,width:3000,height:4200,rotation:0 } })),...patch }; }

test('fit selects a centered source crop without changing the finished print or paper geometry',()=>{
  assert.deepEqual(crop.sheetCropFit(3000,4200,5,7),{ x:0,y:0,width:1,height:1 });
  const landscape=crop.sheetCropFit(6000,4000,5,7); near(landscape.width,10/21); near(landscape.x,11/42); assert.equal(landscape.height,1); assert.equal(landscape.y,0);
  const portrait=crop.sheetCropFit(2000,4000,5,7); assert.equal(portrait.width,1); near(portrait.height,.7); near(portrait.y,.15);
  for (const value of [0,-1,NaN,Infinity]) assert.throws(()=>crop.sheetCropFit(value,4000,5,7));
  const geometry=layouts.sheetGeometry(document()); assert.deepEqual(geometry.cells.map(c=>[c.widthInches,c.heightInches]),[[5,7],[5,7]]);
});

test('direct photo drag pans in source coordinates, clamps all edges and retains its crop shape',()=>{
  const initial={ x:.2,y:.2,width:.5,height:.5 },moved=crop.sheetCropPan(initial,100,-100,200,200); assert.deepEqual(moved,{ x:0,y:.45,width:.5,height:.5 }); assert.deepEqual(initial,{ x:.2,y:.2,width:.5,height:.5 });
  assert.deepEqual(crop.sheetCropPan(initial,-10000,10000,200,200),{ x:.5,y:0,width:.5,height:.5 });
  for (const dimensions of [[0,100],[100,0],[NaN,100]]) assert.strictEqual(crop.sheetCropPan(initial,10,10,...dimensions),initial);
  for (const scale of [1,2,5]) assert.deepEqual(crop.sheetCropPan(initial,100*scale,-100*scale,200*scale,200*scale),moved,'Moving the same fraction of a responsive preview retains the identical source crop');
});

test('photo zoom is centered and bounded while integer snapping matches the rectangle saved to the server',()=>{
  const fit=crop.sheetCropFit(3000,4200,5,7),two=crop.sheetCropZoom(fit,fit,2); assert.deepEqual(two,{ x:.25,y:.25,width:.5,height:.5 });
  assert.deepEqual(crop.sheetCropZoom(two,fit,1),fit); assert.deepEqual(crop.sheetCropZoom(fit,fit,999),{ x:.375,y:.375,width:.25,height:.25 }); assert.deepEqual(crop.sheetCropZoom(two,fit,NaN),fit);
  for (const [width,height] of [[3000,4200],[4001,3007],[1921,2401],[6000,4000]]) for (const zoom of [1,1.01,1.3,2.4,4]) {
    const f=crop.sheetCropFit(width,height,5,7),normalized=crop.sheetCropPan(crop.sheetCropZoom(f,f,zoom),-123,59,390,546),snapped=crop.sheetCropSnap(normalized,width,height),pixels=crop.sheetCropToPixels(snapped,width,height);
    assert.deepEqual(pixels,crop.sheetCropToPixels(normalized,width,height)); assert.deepEqual(crop.sheetCropSnap(snapped,width,height),snapped); assert(Number.isInteger(pixels.x)&&Number.isInteger(pixels.y)&&Number.isInteger(pixels.width)&&Number.isInteger(pixels.height)); assert(pixels.x>=0&&pixels.y>=0&&pixels.x+pixels.width<=width&&pixels.y+pixels.height<=height); assert.equal(pixels.rotation,0);
  }
  assert.deepEqual(crop.sheetCropImageStyle(two),{ position:'absolute',maxWidth:'none',width:'200%',height:'200%',left:'-50%',top:'-50%' });
});

test('paper preview positions and layout readiness reject unsupported fits, missing photos and insufficient crop detail',()=>{
  const doc=document(),g=layouts.sheetGeometry(doc); assert.deepEqual(builder.sheetCellPosition(g.cells[0],g),{ left:'0%',top:'0%',width:'50%',height:'100%' }); assert.equal(builder.sheetReady(doc,[photo]),true); assert.equal(builder.sheetReady(doc,[]),false);
  assert.equal(builder.sheetFits({ ...doc,paperId:'8x10',orientation:0 },'two-5x7'),false); assert.equal(builder.sheetFits({ ...doc,paperId:'8x10',orientation:90 },'two-5x7'),true); assert.equal(builder.sheetFits(doc,'single-8x10'),false);
  for (const change of [cell=>({ ...cell,assetId:null }),cell=>({ ...cell,crop:null }),cell=>({ ...cell,crop:{ ...cell.crop,width:500,height:700 } }),cell=>({ ...cell,crop:{ ...cell.crop,x:1 } })]) assert.equal(builder.sheetReady(document({ cells:[change(doc.cells[0]),doc.cells[1]] }),[photo]),false);
  const larger=layouts.sheetGeometry({ ...doc,paperId:'8x10' }); assert.deepEqual(builder.sheetCellPosition(larger.cells[0],larger),{ left:'0%',top:'6.25%',width:'50%',height:'87.5%' });
});

function editorProps(patch={}) { return { crop:{ x:0,y:0,width:1,height:1 },fit:{ x:0,y:0,width:1,height:1 },sourceWidth:3000,sourceHeight:4200,targetWidth:5,targetHeight:7,label:'SYNTHETIC 5×7',ready:true,reviewed:false,busy:false,onReview(){},onChange(){},onSave(){},onCancel(){},...patch }; }
test('every crop edit clears explicit manual review, even resetting to the exact previously reviewed rectangle',()=>{
  let reviewed=true,chosen={ x:0,y:0,width:1,height:1 }; const events=[],props=editorProps({ reviewed:true,onReview:value=>{ reviewed=value;events.push('review'); },onChange:value=>{ chosen=value;events.push('change'); } });
  const reset=nodes(crop.SheetCropEditor(props)).find(node=>node.type==='button'&&text(node)==='Reset'); reset.props.onClick(); assert.deepEqual(chosen,props.fit); assert.equal(reviewed,false); assert.deepEqual(events,['review','change']);
  let tree=crop.SheetCropEditor({ ...props,reviewed }); assert.equal(nodes(tree).find(node=>node.type==='button'&&text(node)==='Keep this crop').props.disabled,true);
  for (const input of nodes(crop.SheetCropEditor(props)).filter(node=>node.type==='input'&&node.props.type==='range')) { reviewed=true;input.props.onChange({ target:{ value:input.props.value } }); assert.equal(reviewed,false,'An unchanged range interaction still requires a fresh human review'); }
  const checkbox=nodes(crop.SheetCropEditor({ ...props,reviewed:false })).find(node=>node.type==='input'&&node.props.type==='checkbox'); assert.equal(checkbox.props.checked,false); checkbox.props.onChange({ target:{ checked:true } }); assert.equal(reviewed,true);
  tree=crop.SheetCropEditor({ ...props,reviewed }); assert.equal(nodes(tree).find(node=>node.type==='button'&&text(node)==='Keep this crop').props.disabled,false);
  for (const patch of [{ ready:false,reviewed:true },{ busy:true,reviewed:true },{ reviewed:true,sourceWidth:999,sourceHeight:1399 }]) assert.equal(nodes(crop.SheetCropEditor(editorProps(patch))).find(node=>node.type==='button'&&text(node)==='Keep this crop').props.disabled,true);
});

test('paper-frame pointer and keyboard interactions move the photo while retaining the fixed cell geometry',()=>{
  const local=load('components/labs/sheet-crop-editor.tsx',{ ...deps,react:{ useRef:value=>({ current:value }) } }),changes=[],initial={ x:.25,y:.25,width:.5,height:.5 };
  const frame=local.SheetCropFrame({ url:'blob:SYNTHETIC-only',width:3000,height:4200,crop:initial,fit:{ x:0,y:0,width:1,height:1 },label:'SYNTHETIC',disabled:false,onChange:value=>changes.push(value),onReady(){} }); frame.props.ref.current={ getBoundingClientRect:()=>({ width:200,height:280 }),clientWidth:200,clientHeight:280 };
  const event={ button:0,pointerId:7,clientX:100,clientY:100,preventDefault(){},stopPropagation(){},currentTarget:{ setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){} } }; frame.props.onPointerDown(event); frame.props.onPointerMove({ ...event,clientX:200,clientY:100 }); assert.deepEqual(changes.pop(),{ x:0,y:.25,width:.5,height:.5 }); frame.props.onPointerUp(event); frame.props.onPointerMove({ ...event,clientX:10 }); assert.equal(changes.length,0,'Ended gestures cannot keep changing a crop');
  frame.props.onKeyDown({ ...event,key:'ArrowRight',shiftKey:false }); near(changes.pop().x,.2425); frame.props.onKeyDown({ ...event,key:'ArrowRight',shiftKey:true }); near(changes.pop().x,.22);
  assert.deepEqual(initial,{ x:.25,y:.25,width:.5,height:.5 }); assert.equal(frame.props.style,undefined,'Moving a photo does not resize or reposition its finished print container');
});

function hookHarness(extra={}) {
  const slots=[],effects=[]; let cursor=0;
  const slot=(kind,initial)=>{ const index=cursor++; if (!(index in slots)) slots[index]={ kind,value:typeof initial==='function'?initial():initial }; assert.equal(slots[index].kind,kind); return slots[index]; };
  const hooks={ ...React,useRef:initial=>slot('ref',()=>({ current:initial })).value,useState:initial=>{ const current=slot('state',initial); return [current.value,next=>{ current.value=typeof next==='function'?next(current.value):next; }]; },useCallback:(fn,dependencies)=>{ const current=slot('callback',()=>({ fn,dependencies })); if (dependencies.some((dependency,index)=>!Object.is(dependency,current.value.dependencies[index]))) current.value={ fn,dependencies }; return current.value.fn; },useEffect:(effect,dependencies)=>{ const current=slot('effect',()=>({ dependencies:null })); if (!current.value.dependencies || dependencies.some((dependency,index)=>!Object.is(dependency,current.value.dependencies[index]))) { current.value.dependencies=dependencies; effects.push(effect); } } };
  const local=load('components/labs/sheet-layout-builder.tsx',{ ...deps,...extra,react:hooks,'./sheet-crop-editor':crop });
  return { local,render(component,props){ cursor=0;return component(props); },effects };
}
function thumbnailHarness(patch={}) {
  const h=hookHarness(),assigned=[],hovered=[],queried=[],captured=new Set(),events=[]; let props={ assetId:photo.id,filename:photo.filename,width:photo.widthPixels,height:photo.heightPixels,url:'blob:SYNTHETIC-preview',selected:false,disabled:false,onAssign:cell=>assigned.push(cell),onHoverCell:cell=>hovered.push(cell),targetAtPoint:(x,y)=>{ queried.push([x,y]);return x>=200&&x<400&&y>=0&&y<280?'b':null; },children:'SYNTHETIC preview',...patch };
  const render=next=>{ if (next) props={ ...props,...next }; return h.render(h.local.SheetPhotoThumbnail,props); },button=()=>nodes(render()).find(node=>node.type==='button');
  const event=(patch={})=>({ button:0,pointerId:7,pointerType:'mouse',clientX:20,clientY:300,detail:1,preventDefault(){ events.push('prevent'); },stopPropagation(){ events.push('stop'); },currentTarget:{ setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id) },...patch });
  return { render,button,event,assigned,hovered,queried,captured,events };
}

test('photo drag threshold and drop targets reject outside paper, foreign cells and invalid pointer coordinates',()=>{
  assert.equal(builder.sheetPhotoDragMoved(10,10,15.9,10),false); assert.equal(builder.sheetPhotoDragMoved(10,10,16,10),true); assert.equal(builder.sheetPhotoDragMoved(10,10,13.6,14.8),true);
  for (const value of [NaN,Infinity,-Infinity]) for (const position of [0,1,2,3]) { const args=[0,0,10,10]; args[position]=value; assert.equal(builder.sheetPhotoDragMoved(...args),false); }
  const inside={ getAttribute:name=>name==='data-sheet-cell'?'b':null },outside={ getAttribute:()=> 'a' },unknown={ getAttribute:()=> 'foreign-cell' },paper={ contains:element=>element===inside||element===unknown },element=target=>({ closest:selector=>{ assert.equal(selector,'[data-sheet-cell]');return target; } });
  assert.equal(builder.sheetPhotoDropTarget(element(inside),paper,['a','b']),'b');
  for (const [target,paperNode,ids] of [[null,paper,['a','b']],[element(null),paper,['a','b']],[element(outside),paper,['a','b']],[element(unknown),paper,['a','b']],[element(inside),null,['a','b']],[element(inside),paper,['a']]]) assert.equal(builder.sheetPhotoDropTarget(target,paperNode,ids),null);
});

test('mouse and touch drags capture one pointer, assign the exact paper cell once and suppress the following click',()=>{
  for (const pointerType of ['mouse','touch','pen']) {
    const h=thumbnailHarness(),button=h.button(),down=h.event({ pointerType }); assert.equal(button.props.draggable,false); assert.equal(button.props['data-sheet-photo'],photo.id); button.props.onPointerDown(down); assert(h.captured.has(7));
    button.props.onPointerMove(h.event({ pointerId:8,pointerType,clientX:250,clientY:150 })); assert.deepEqual(h.queried,[],'Another pointer cannot move this photograph');
    button.props.onPointerMove(h.event({ pointerType,clientX:250,clientY:150 })); assert.deepEqual(h.hovered,['b']); assert(nodes(h.render()).some(node=>node.type==='div'&&node.props['aria-hidden']==='true'),'Dragging shows an image ghost');
    h.button().props.onPointerUp(h.event({ pointerType,clientX:250,clientY:150 })); assert.deepEqual(h.assigned,['b']); assert.equal(h.captured.size,0); assert.equal(h.hovered.at(-1),null); assert(!nodes(h.render()).some(node=>node.type==='div'&&node.props['aria-hidden']==='true'));
    h.button().props.onLostPointerCapture(h.event({ pointerType })); h.button().props.onClick(h.event({ pointerType })); assert.deepEqual(h.assigned,['b'],'The synthetic post-drag click cannot also fill the selected cell');
    h.button().props.onClick(h.event({ pointerType,detail:0 })); assert.deepEqual(h.assigned,['b',undefined],'Keyboard activation remains available after dragging');
  }
});

test('off-paper, cancelled, lost-capture and newly disabled drags cannot assign a photo',()=>{
  for (const ending of ['outside','cancel','lost','disabled']) {
    const h=thumbnailHarness(),button=h.button(); button.props.onPointerDown(h.event()); button.props.onPointerMove(h.event({ clientX:250,clientY:150 }));
    if (ending==='outside') h.button().props.onPointerUp(h.event({ clientX:500,clientY:150 }));
    if (ending==='cancel') h.button().props.onPointerCancel(h.event());
    if (ending==='lost') h.button().props.onLostPointerCapture(h.event());
    if (ending==='disabled') { h.render({ disabled:true });h.button().props.onPointerUp(h.event({ clientX:250,clientY:150 })); }
    assert.equal(h.hovered.at(-1),null); assert(!nodes(h.render()).some(node=>node.type==='div'&&node.props['aria-hidden']==='true')); h.button().props.onClick(h.event()); assert.deepEqual(h.assigned,[],ending);
    h.button().props.onPointerMove(h.event({ clientX:250,clientY:150 })); h.button().props.onPointerUp(h.event({ clientX:250,clientY:150 })); assert.deepEqual(h.assigned,[],ending+' cannot resume without a new pointer down');
  }
  for (const patch of [{ disabled:true },{ url:undefined }]) { const h=thumbnailHarness(patch); h.button().props.onPointerDown(h.event()); h.button().props.onPointerUp(h.event({ clientX:250,clientY:150 })); assert.equal(h.captured.size,0); assert.deepEqual(h.assigned,[]); }
  const right=thumbnailHarness();right.button().props.onPointerDown(right.event({ button:2 })); assert.equal(right.captured.size,0);
});

test('a final pointer position can complete a drag without move events while a short tap retains click selection',()=>{
  const fast=thumbnailHarness();fast.button().props.onPointerDown(fast.event());fast.button().props.onPointerUp(fast.event({ clientX:250,clientY:150 })); assert.deepEqual(fast.assigned,['b']);fast.button().props.onClick(fast.event()); assert.deepEqual(fast.assigned,['b']);
  const tap=thumbnailHarness();tap.button().props.onPointerDown(tap.event());tap.button().props.onPointerUp(tap.event({ clientX:23,clientY:302 })); assert.deepEqual(tap.assigned,[]);tap.button().props.onClick(tap.event());assert.deepEqual(tap.assigned,[undefined]); assert.equal(tap.captured.size,0);
});

test('foreign pointer cancellation cannot erase the active captured photo drag',()=>{
  const h=thumbnailHarness();h.button().props.onPointerDown(h.event());h.button().props.onPointerMove(h.event({ clientX:250,clientY:150 }));
  for (const handler of ['onPointerCancel','onLostPointerCapture']) h.button().props[handler](h.event({ pointerId:8 }));assert(nodes(h.render()).some(node=>node.type==='div'&&node.props['aria-hidden']==='true'));h.button().props.onPointerUp(h.event({ clientX:250,clientY:150 }));assert.deepEqual(h.assigned,['b']);
});

test('a job sheet rejects foreign photo IDs and external uploads while assignment requires fresh crop review',async()=>{
  const original=globalThis.sessionStorage,requests=[],workspace={ drafts:[],sources:[photo],canCreate:true,jobId:'22222222-2222-4222-8222-222222222222',jobReference:'SYNTHETIC existing job' },user={ id:'33333333-3333-4333-8333-333333333333' };
  globalThis.sessionStorage={ removeItem(){} };
  try {
    const h=hookHarness({ '@/lib/supabase/client':{ createClient:()=>({ auth:{ getSession:async()=>({ data:{ session:{ access_token:'SYNTHETIC-not-a-token',user } } }),onAuthStateChange:()=>({ data:{ subscription:{ unsubscribe(){} } } }) } }) },'./production-client':{ productionSessionRead:()=>null,productionSessionWrite(){},productionFetch:async(path,body)=>{ requests.push({ path,body });assert.equal(body,undefined,'This UI test must never submit a write');return { json:async()=>({ ok:true,workspace }) }; } } }),render=()=>h.render(h.local.SheetLayoutBuilder,{ audience:'lab',jobId:workspace.jobId });
    render();h.effects.splice(0).forEach(effect=>effect()); for (let i=0;i<6;i++) await Promise.resolve(); let tree=render();
    const paperLabel=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith('1. Choose paper')),paper=nodes(paperLabel).find(node=>node.type==='select');assert(paper);paper.props.onChange({ target:{ value:'7x10' } });tree=render();
    const thumb=nodes(tree).find(node=>node.type===h.local.SheetPhotoThumbnail);assert(thumb);assert.equal(thumb.props.disabled,true,'An unrendered private preview cannot be assigned');const preview=nodes(thumb).find(node=>typeof node.type==='function'&&node.props.source?.id===photo.id);assert(preview);preview.props.onReady('blob:SYNTHETIC-decoded');tree=render();
    const cell=nodes(tree).find(node=>node.props?.['data-sheet-cell']==='b');assert(cell);const drop=id=>cell.props.onDrop({ preventDefault(){},dataTransfer:{ getData:()=>id } });drop('44444444-4444-4444-8444-444444444444');assert(!nodes(render()).some(node=>node.type===crop.SheetCropEditor),'A foreign or unlisted original never opens crop review');
    const section=nodes(tree).find(node=>node.type==='section'&&node.props['data-dropzone']===false);assert(section);section.props.onDrop({ preventDefault(){},stopPropagation(){},dataTransfer:{ files:[new File(['SYNTHETIC'],'SYNTHETIC.jpg',{ type:'image/jpeg' })] } });assert.equal(requests.length,1,'Dropping an external file in a job cannot upload a new original');assert(text(render()).includes('Use only the photos assigned to this job.'));
    drop(photo.id);tree=render();const editor=nodes(tree).find(node=>node.type===crop.SheetCropEditor);assert(editor);assert.equal(editor.props.ready,false);assert.equal(editor.props.reviewed,false);assert.equal(nodes(tree).find(node=>node.type===h.local.SheetPhotoThumbnail).props.disabled,true,'No second photo can be assigned while this print needs crop review');assert.match(nodes(tree).find(node=>node.props?.['data-sheet-cell']==='a').props['aria-label'],/empty/,'Assigning b leaves a unchanged');
    assert.equal(requests.length,1);assert.deepEqual(workspace.sources,[photo]);
  } finally { if (original===undefined) delete globalThis.sessionStorage;else globalThis.sessionStorage=original; }
});
