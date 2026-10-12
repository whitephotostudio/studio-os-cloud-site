import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
const compiled=ts.transpileModule(readFileSync(new URL('../components/order-payment-controls.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const snapshot={paymentId:'pi_fixture',currency:'cad',chargedCents:1000,refundedCents:1000,remainingCents:0,pending:true,canRefund:false,canCancel:false,orderIds:['order_fixture'],status:'Refund pending',customer:'Fixture customer',applicationFeeRefundPending:true,canCompleteApplicationFeeRefund:true,applicationFeeRefundRemainingCents:30,applicationFeeCurrency:'cad'};
function fixture(payment){
 const states=[true,payment,'','',false,false];let cursor=0,changed=0;const inFlight={current:false};
 const react={useState(initial){const index=cursor++;return [index<states.length?states[index]:initial,value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef:()=>inFlight};
 const exports={};new Function('require','exports',compiled)(name=>name==='react'?react:require(name),exports);
 const props={orderId:'order_fixture',supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}})}},onChanged:async()=>{changed++;}};
 const render=()=>{cursor=0;return exports.OrderPaymentControls(props);};
 return {render,states,changed:()=>changed};
}
function nodes(tree){const result=[];function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object'||!node.props)return;result.push(node);visit(node.props.children);}visit(tree);return result;}
function button(tree,label){const matches=nodes(tree).filter(node=>node.type==='button'&&node.props.children===label);assert.equal(matches.length,1,`one ${label} button`);return matches[0];}

test('fee recovery renders its actual remaining fee and recipient rather than a second zero-dollar customer refund',()=>{
 const tree=fixture(snapshot).render();const html=renderToStaticMarkup(tree);
 assert.ok(html.includes('Refund the remaining $0.30 Studio OS platform fee to the studio’s Stripe balance.'));
 assert.ok(html.includes('The customer payment is already fully refunded.'));
 assert.ok(button(tree,'Complete platform fee refund').props.disabled);
 assert.doesNotMatch(html,/Refund \$0\.00 to the original payment method/);
});

test('platform fee recovery requires both a reason and explicit confirmation, then sends the existing owner-scoped POST',async()=>{
 const f=fixture(snapshot);let tree=f.render();
 nodes(tree).find(node=>node.type==='textarea').props.onChange({target:{value:'Manual customer refund'}});
 tree=f.render();assert.ok(button(tree,'Complete platform fee refund').props.disabled,'reason alone is insufficient');
 nodes(tree).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});
 tree=f.render();assert.equal(button(tree,'Complete platform fee refund').props.disabled,false);
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,...options});return Response.json({ok:true,status:'refunded',message:'Platform fee refund confirmed.'});};
 try{
  button(tree,'Complete platform fee refund').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/dashboard/orders/payment');assert.equal(calls[0].method,'POST');
  assert.deepEqual(JSON.parse(calls[0].body),{orderId:'order_fixture',action:'refund',reason:'Manual customer refund',paymentId:'pi_fixture',amountCents:0,orderIds:['order_fixture']});
  assert.equal(f.changed(),1);assert.ok(renderToStaticMarkup(f.render()).includes('Platform fee refund confirmed.'));
 }finally{globalThis.fetch=original;}
});

test('pending customer refunds and incomplete fee quotations cannot expose a money action',()=>{
 for(const changes of [{canCompleteApplicationFeeRefund:false},{applicationFeeRefundPending:false},{applicationFeeRefundRemainingCents:0},{applicationFeeCurrency:null}]){
  const tree=fixture({...snapshot,...changes}).render();
  assert.equal(nodes(tree).filter(node=>node.type==='button'&&node.props.children==='Complete platform fee refund').length,0);
 }
});

test('existing customer refund confirmation retains the amount and original-payment recipient',()=>{
 const tree=fixture({...snapshot,pending:false,canRefund:true,remainingCents:1000,refundedCents:0,applicationFeeRefundPending:false,canCompleteApplicationFeeRefund:false}).render();
 assert.ok(renderToStaticMarkup(tree).includes('Refund $10.00 to the original payment method and close the order.'));
 assert.ok(button(tree,'Confirm refund').props.disabled);
});

test('fee recovery formats actual settlement minor units for zero-decimal currencies',()=>{
 const tree=fixture({...snapshot,applicationFeeRefundRemainingCents:30,applicationFeeCurrency:'jpy'}).render();
 assert.match(renderToStaticMarkup(tree),/remaining (?:JP)?¥30 Studio OS platform fee/);
});
