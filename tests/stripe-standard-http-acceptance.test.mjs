import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHttpAcceptanceTargets,assertAcceptancePhaseAllowed,acceptanceCaseDefinition,assertInterruptionEvidence } from '../scripts/stripe-standard-http-acceptance.mjs';

const exact={expectedPlatform:'acct_1UQo3XLkdaBBHhB9',database:'http://127.0.0.1:55421',origin:'http://localhost:55430'};
test('HTTP acceptance pins the isolated sandbox, Supabase transport and actual Next canonical origin',()=>{
  assert.equal(assertHttpAcceptanceTargets(exact),exact);
  for(const bad of [{expectedPlatform:'acct_1TBlT4PxlnWeytFA'},{database:'https://production.supabase.co'},{origin:'https://studiooscloud.com'},{origin:'http://localhost.evil.example:55430'},{database:'http://127.0.0.1:54321'},{origin:'http://localhost:3000'}])assert.throws(()=>assertHttpAcceptanceTargets({...exact,...bad}));
});
test('financial/routing acceptance stages need explicit root authorization; unpaid subscription and reads remain separate',()=>{
  for(const phase of ['change-plan','refund','partial-refund','refund-unfulfilled','activate','rollback']){
    assert.throws(()=>assertAcceptancePhaseAllowed(phase),/explicitly authorize/);
    assert.doesNotThrow(()=>assertAcceptancePhaseAllowed(phase,true));
  }
  for(const phase of ['status','subscribe','verify-subscription','recover-subscription','prepare-order','legacy-checkout','checkout','retry-checkout','verify-interruption','adopt-browser-order','verify-orders','verify-refund','recover-customer-events','backfill','initialize-routing'])assert.doesNotThrow(()=>assertAcceptancePhaseAllowed(phase));
  assert.throws(()=>assertAcceptancePhaseAllowed('pay-parent-directly'),/Unknown/);
});
test('HTTP cases describe the shipped branch and complete group/waiver scope without false workflow claims',()=>{
  const gallery=acceptanceCaseDefinition({plan:'starter',kind:'gallery',currency:'cad'});
  assert.equal(gallery.actualParentKind,'event');assert.equal(gallery.actualWorkflowType,'event');assert.equal(gallery.feeCents,55);
  const school=acceptanceCaseDefinition({plan:'core',kind:'school',currency:'usd',variant:'group',name:'old-open'});
  assert.equal(school.actualParentKind,'school');assert.equal(school.count,2);assert.equal(school.feeCents,90);
  assert.equal(school.label,'core-school-usd-group-old-open');
  assert.equal(acceptanceCaseDefinition({plan:'studio',kind:'event',currency:'cad',variant:'mixed-waiver'}).feeCents,45);
  assert.equal(acceptanceCaseDefinition({plan:'starter',kind:'event',currency:'usd',variant:'waived'}).feeCents,0);
  for(const bad of [{plan:'admin'},{kind:'pretend-portrait-route'},{currency:'eur'},{variant:'hundred-orders'},{name:'../../production'}])assert.throws(()=>acceptanceCaseDefinition({plan:'starter',kind:'event',currency:'cad',...bad}),/Invalid bounded/);
});
test('interruption proof requires the exact real fault mode and its committed boundary',()=>{
  const base={format:'studio-standard-private-fault-proof-v1',sessionId:'cs_test_synthetic',accountId:'acct_SYNTHETIC',requestHash:'a'.repeat(64),attemptId:'efb9e1f5-1740-4ef1-aa4e-f3c96b3099d1'};
  assert.doesNotThrow(()=>assertInterruptionEvidence({...base,mode:'lost_checkout_response',providerCommitted:true}));
  assert.doesNotThrow(()=>assertInterruptionEvidence({...base,mode:'lost_bind_response',databaseCommitted:true}));
  for(const invalid of [{mode:'lost_checkout_response',databaseCommitted:true},{mode:'lost_bind_response',providerCommitted:true},{mode:'db_bind_failure',databaseCommitted:true},
    {mode:'lost_checkout_response',providerCommitted:true,sessionId:'cs_live_bad'},{mode:'lost_checkout_response',providerCommitted:true,requestHash:''}])assert.throws(()=>assertInterruptionEvidence({...base,...invalid}),/Genuine committed/);
});
