import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutAttemptIdentity, canonicalCheckoutJson } from '../lib/checkout-attempt.ts';
import { checkoutAttemptForPayload } from '../lib/checkout-attempt-client.ts';
import { orderCheckoutIdempotencyKey, allocateRefundCents, assertPaymentBelongsToOrders, verifyPaymentConfirmation } from '../lib/order-payment-policy.ts';

test('reload, back navigation and lost responses retain the same attempt', async () => {
  const memory = new Map(); const storage = { getItem: (k) => memory.get(k), setItem: (k,v) => memory.set(k,v) };
  const payload = { parent: { email: 'test@example.test' }, quantity: 1 };
  const first = await checkoutAttemptForPayload('school', payload, storage);
  assert.equal(await checkoutAttemptForPayload('school', structuredClone(payload), storage), first);
  assert.notEqual(await checkoutAttemptForPayload('school', {...payload, quantity: 2}, storage), first);
  assert.equal(await checkoutAttemptForPayload('school',payload,storage), first);
  assert.notEqual(await checkoutAttemptForPayload('explicit-reorder',payload,storage),first);
  await assert.rejects(() => checkoutAttemptForPayload('school', payload, {getItem: () => null, setItem: () => { throw Error('storage blocked'); }}));
});
test('server identities are stable across JSON ordering and bound to payload', () => {
  assert.equal(canonicalCheckoutJson({b: 2,a: 1}), canonicalCheckoutJson({a: 1,b: 2}));
  const id = crypto.randomUUID();
  assert.deepEqual(checkoutAttemptIdentity('single',{b: 2,a: 1},id), checkoutAttemptIdentity('single',{a: 1,b: 2},id));
  assert.notEqual(checkoutAttemptIdentity('single',{a: 1},id).hash, checkoutAttemptIdentity('single',{a: 2},id).hash);
  assert.throws(() => checkoutAttemptIdentity('single', {}, 'bad'));
});
test('combined refunds allocate cents exactly once, including partial and odd amounts', () => {
  for (let cents=0; cents<=301; cents++) {
    const allocations = allocateRefundCents(cents, [100,101,100]);
    assert.equal(allocations.reduce((a,b)=>a+b,0), cents);
    allocations.forEach((n,i)=>assert.ok(n>=0 && n<=[100,101,100][i]));
  }
  assert.deepEqual(allocateRefundCents(301,[100,101,100]),[100,101,100]);
  assert.throws(()=>allocateRefundCents(302,[100,101,100]));
});
const orders = [{id:'order',photographer_id:'studio',order_group_id:null,total_cents:10360,currency:'cad',stripe_payment_intent_id:'pi_test'}];
const payment = {id:'pi_test',amount:10360,currency:'cad',metadata:{photographer_id:'studio',order_id:'order'}};
test('a refund cannot cross studio, payment, currency or amount boundaries',()=>{
  assert.doesNotThrow(()=>assertPaymentBelongsToOrders(orders,payment));
  for (const bad of [{...payment,amount:10400},{...payment,currency:'usd'},{...payment,id:'pi_other'},{...payment,metadata:{...payment.metadata,photographer_id:'other'}},{...payment,metadata:{...payment.metadata,order_id:'other'}}]) {
    assert.throws(()=>assertPaymentBelongsToOrders(orders,bad));
  }
});
test('refund confirmation becomes invalid when Stripe changes or a linked order is omitted',()=>{
  const snapshot = {paymentId:'pi_test',remainingCents:10360,canRefund:true,canCancel:false,orderIds:['a','b']};
  const body={action:'refund',paymentId:'pi_test',amountCents:10360,orderIds:['b','a']};
  assert.doesNotThrow(()=>verifyPaymentConfirmation(snapshot,body));
  assert.throws(()=>verifyPaymentConfirmation({...snapshot,remainingCents:10000},body));
  assert.throws(()=>verifyPaymentConfirmation({...snapshot,canRefund:false},body));
  assert.throws(()=>verifyPaymentConfirmation(snapshot,{...body,orderIds:['a']}));
  assert.throws(()=>verifyPaymentConfirmation(snapshot,{...body,action:'cancel'}));
});

test('an expired session gets a fresh stable key; ordinary retries reuse the original',()=>{
  assert.equal(orderCheckoutIdempotencyKey('one'), 'studio-os-order-session-one');
  assert.equal(orderCheckoutIdempotencyKey('one', 'cs_expired'), 'studio-os-order-session-one-cs_expired');
  assert.notEqual(orderCheckoutIdempotencyKey('one','cs_expired'),orderCheckoutIdempotencyKey('one'));
});

test('partial refund allocations never regress when later webhooks increase the total',()=>{
  let previous=[0,0,0];
  for(let amount=0;amount<=10;amount++) {
    const next=allocateRefundCents(amount,[3,1,6]);
    next.forEach((value,index)=>assert.ok(value>=previous[index]));
    previous=next;
  }
});
