import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const bound={enabled:true,testOnly:false,currentAccountId:'acct_express',pending:{accountId:'acct_standard',country:'CA',ready:true,ownershipBound:true,message:'Ready'},history:[],activationAvailable:false};
function component(status,{confirmed=false,busy=false,signedIn=true}={}){
  const states=[status,busy,confirmed,null,null,[]];let index=0;
  const react={useState:()=>[states[index++],()=>{}],useEffect:()=>{},useCallback:callback=>callback};
  const code=ts.transpileModule(readFileSync(new URL('../components/dashboard/stripe-standard-migration.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const result={};new Function('require','exports',code)(name=>name==='react'?react:require(name),result);
  return result.StripeStandardMigration({accessToken:null,signedIn});
}
function elements(node,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(item=>elements(item,result));return result;}result.push(node);elements(node.props?.children,result);return result;}
const button=(tree,text)=>elements(tree).find(node=>node.type==='button'&&node.props.children===text);
test('securely bound live Standard remains visibly reverifiable before cutover and still requires confirmation',()=>{
  for(const confirmed of [false,true]){const tree=component(bound,{confirmed}),reverify=button(tree,'Reverify Standard account');assert.ok(reverify);assert.equal(reverify.props.disabled,!confirmed);assert.ok(renderToStaticMarkup(tree).includes('Reverify Standard account'));}
  assert.equal(button(component(bound,{confirmed:true,busy:true}),'Reverify Standard account').props.disabled,true);
  assert.equal(button(component({...bound,pending:{...bound.pending,ownershipBound:false}}),'Verify existing Standard ownership').props.disabled,true);
});
test('reverify is hidden after Standard selection and on disabled or signed-out panels',()=>{
  const selected={...bound,currentAccountId:'acct_standard',history:[{accountId:'acct_standard',accountType:'standard',status:'active'}]};
  assert.equal(button(component(selected,{confirmed:true}),'Reverify Standard account'),undefined);
  assert.equal(component({...bound,enabled:false}),null);assert.equal(component(bound,{signedIn:false}),null);
});
test('confirmed reverify uses the existing authenticated start POST and exact displayed pair without invoking activation',async t=>{
  const original=globalThis.fetch,calls=[];t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>url.endsWith('/start')?{ok:true,accountId:'acct_standard',ownershipBound:true}:{ok:true,...bound}};};
  await button(component(bound,{confirmed:true}),'Reverify Standard account').props.onClick();
  assert.deepEqual(calls.map(call=>call.url),['/api/stripe/standard/start','/api/stripe/standard/status']);
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.credentials,'include');
  assert.deepEqual(JSON.parse(calls[0].options.body),{accountId:'acct_standard',expectedCurrentAccountId:'acct_express',confirmed:true});
  assert.equal(calls.some(call=>call.url.endsWith('/activate')),false);
});
