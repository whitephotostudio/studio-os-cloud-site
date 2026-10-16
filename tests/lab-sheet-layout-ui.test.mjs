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
