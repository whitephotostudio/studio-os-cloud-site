import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/labs/production-v2-guidance.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const guidance = {};
new Function('require', 'exports', code)(name => { throw Error(`Pure guidance cannot request ${name}`); }, guidance);
const { productionV2ShortReference: shortReference, productionV2PrintStage: printStage, productionV2ReviewComplete: reviewComplete, productionV2NextStep: nextStep } = guidance;
const IDS = ['8x10', '5x7-a', '5x7-b'];
const STAMP = '2026-10-16T10:00:00.000Z';
const POLICY = { autoApprove: false, cropResponsibility: 'photographer', labColourCorrection: false };
const asset = (id, kind = 'crop') => ({ id, kind, filename: `SYNTHETIC-${id}.jpg`, sha256: 'a'.repeat(64), byteSize: 1234, widthPixels: 1500, heightPixels: 2100, contentType: 'image/jpeg' });
function slot(id, patch = {}) {
  return { id, photoId: `public-${id}`, size: id === '8x10' ? '8x10' : '5x7', quantity: 2, widthInches: id === '8x10' ? 8 : 5, heightInches: id === '8x10' ? 10 : 7,
    source: asset(`source-${id}`, 'original'), crop: null, cropAsset: null, cropApproved: false, cropApprovedAt: null,
    colourAsset: null, colourCompletedAt: null, finalAsset: null, finalReviewedAt: null, ...patch };
}
function job(patch = {}) {
  return { workflowVersion: 2, id: 'synthetic-job', reference: 'PROOF2-0123456789ABCDEF0123456789ABCDEF', galleryId: 'synthetic-gallery', version: 9, status: 'accepted', studioName: 'SYNTHETIC studio', targetLabel: 'SYNTHETIC receiving workspace', targetKind: 'in_house', amountKind: 'retail', policy: { ...POLICY },
    offer: { id: 'synthetic-offer', name: 'SYNTHETIC package', retailCents: 4275, contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] }, currency: 'CAD', quantity: 2, subtotalMinor: 8550,
    slots: IDS.map(id => slot(id)), availablePhotos: [], photographerApproved: true, photographerApprovedAt: STAMP,
    holds: IDS.flatMap(id => [`crop_${id}`, `final_review_${id}`]), events: [], dispatchState: 'idle', reprintOf: null,
    canReceive: true, canApproveOrder: true, canCrop: true, canChangeSource: true, canReopen: false, canReprint: false,
    testOnly: true, payment: 'test_no_payment', printAllowed: false, createdAt: STAMP, updatedAt: STAMP, ...patch };
}
function reviewed(patch = {}) {
  const value = job({ holds: [], ...patch });
  value.slots = IDS.map(id => {
    const crop = asset(`crop-${id}`), corrected = asset(`colour-${id}`), final = value.policy.labColourCorrection ? corrected : crop;
    return slot(id, { cropAsset: crop, cropApproved: true, cropApprovedAt: STAMP, colourAsset: value.policy.labColourCorrection ? corrected : null, colourCompletedAt: value.policy.labColourCorrection ? STAMP : null, finalAsset: final, finalReviewedAt: STAMP });
  });
  return value;
}
const clone = value => structuredClone(value);
const withoutReceiver = { canReceive: false, targetKind: 'partner_lab' };

// Invented jobs only: these tests never load a customer, price sheet or account.
test('short order references are display-only and do not alter the full saved reference', () => {
  const value = reviewed(), full = value.reference;
  assert.equal(shortReference(full), 'Order · 89ABCDEF');
  assert.equal(shortReference(full), shortReference(full));
  assert.equal(shortReference('PROOF2-ABC123'), 'Order · ABC123');
  assert.equal(shortReference('CUSTOM-123'), 'Order · CUSTOM-123');
  assert.equal(value.reference, full);
});

test('print stages require the exact saved crop, requested colour evidence and current final identity', () => {
  const value = job(), current = value.slots[0], crop = asset('current-crop'), corrected = asset('current-colour');
  assert.equal(printStage(value, current), 'crop');
  assert.equal(printStage(value, { ...current, cropApproved: true }), 'crop', 'A boolean cannot replace missing crop bytes');
  assert.equal(printStage(value, { ...current, cropAsset: crop }), 'approve_crop');
  const approved = { ...current, cropAsset: crop, cropApproved: true };
  assert.equal(printStage(value, approved), 'final_review');
  assert.equal(printStage(value, { ...approved, finalAsset: crop, finalReviewedAt: STAMP }), 'done');
  assert.equal(printStage(value, { ...approved, finalAsset: corrected, finalReviewedAt: STAMP }), 'final_review');
  const colourJob = job({ policy: { ...POLICY, labColourCorrection: true } });
  assert.equal(printStage(colourJob, approved), 'colour');
  assert.equal(printStage(colourJob, { ...approved, colourAsset: corrected }), 'colour');
  assert.equal(printStage(colourJob, { ...approved, colourCompletedAt: STAMP }), 'colour');
  const colourDone = { ...approved, colourAsset: corrected, colourCompletedAt: STAMP };
  assert.equal(printStage(colourJob, { ...colourDone, finalAsset: corrected }), 'final_review');
  assert.equal(printStage(colourJob, { ...colourDone, finalAsset: crop, finalReviewedAt: STAMP }), 'final_review');
  assert.equal(printStage(colourJob, { ...colourDone, finalAsset: corrected, finalReviewedAt: STAMP }), 'done');
});

test('review readiness requires all three distinct print slots and every saved review, beyond an empty holds list', () => {
  assert.equal(reviewComplete(reviewed()), true);
  assert.equal(reviewComplete(reviewed({ policy: { ...POLICY, labColourCorrection: true } })), true);
  const cases = [
    value => { value.photographerApproved = false; value.policy.autoApprove = true; },
    value => { value.holds = ['server-check-still-pending']; },
    value => { value.slots.pop(); },
    value => { value.slots.push(clone(value.slots[0])); },
    value => { value.slots[2].id = '5x7-a'; },
    value => { value.slots[2].id = 'unexpected-print'; },
    value => { value.slots[1].cropAsset = null; },
    value => { value.slots[1].cropApproved = false; },
    value => { value.slots[1].finalAsset = null; },
    value => { value.slots[1].finalReviewedAt = null; },
    value => { value.slots[1].finalAsset = asset('stale-final'); },
  ];
  for (const change of cases) { const value = reviewed(); change(value); assert.equal(reviewComplete(value), false, change.toString()); }
  for (const field of ['colourAsset', 'colourCompletedAt']) { const value = reviewed({ policy: { ...POLICY, labColourCorrection: true } }); value.slots[2][field] = null; assert.equal(reviewComplete(value), false); }
});

test('photographer approval, receiver acceptance and automatic approval remain separate responsibilities', () => {
  const owner = job({ status: 'submitted', photographerApproved: false, ...withoutReceiver });
  assert.equal(nextStep(owner).kind, 'approve_order');
  const receiver = job({ status: 'submitted', photographerApproved: false, canApproveOrder: false, canCrop: false });
  assert.equal(nextStep(receiver).kind, 'accept', 'Lab acceptance is available before the photographer release');
  assert.equal(nextStep({ ...receiver, status: 'accepted' }).kind, 'waiting');
  assert.match(nextStep({ ...receiver, status: 'accepted' }).title, /photographer/i);
  const automatic = job({ ...withoutReceiver, status: 'submitted', photographerApproved: true, policy: { ...POLICY, autoApprove: true } });
  assert.equal(nextStep(automatic).kind, 'crop', 'An owner may perform an assigned crop while waiting for acceptance');
  const unapprovedAutoFlag = { ...automatic, photographerApproved: false };
  assert.equal(nextStep(unapprovedAutoFlag).kind, 'approve_order', 'A policy toggle does not supply saved approval');
});

test('crop and crop-approval guidance follows the assigned capability and identifies the independent slot', () => {
  const owner = job({ ...withoutReceiver });
  assert.deepEqual([nextStep(owner).kind, nextStep(owner).slotId], ['crop', '8x10']);
  const saved = clone(owner); saved.slots[0].cropAsset = asset('saved-8x10');
  assert.deepEqual([nextStep(saved).kind, nextStep(saved).slotId], ['approve_crop', '8x10']);
  const photographerWaiting = job({ ...withoutReceiver, canCrop: false, policy: { ...POLICY, cropResponsibility: 'lab' } });
  assert.equal(nextStep(photographerWaiting).kind, 'waiting'); assert.match(nextStep(photographerWaiting).title, /lab cropping/i);
  const labWaiting = job({ canApproveOrder: false, canCrop: false });
  assert.equal(nextStep(labWaiting).kind, 'waiting'); assert.match(nextStep(labWaiting).title, /photographer cropping/i);
});

test('colour and final-file review are offered only to an accepted receiving workspace', () => {
  const value = job({ policy: { ...POLICY, labColourCorrection: true } });
  value.slots[0] = slot('8x10', { cropAsset: asset('crop-8x10'), cropApproved: true, cropApprovedAt: STAMP });
  assert.deepEqual([nextStep(value).kind, nextStep(value).slotId], ['colour', '8x10']);
  for (const role of [{ status: 'submitted', canReceive: false, canCrop: false }, { status: 'accepted', canReceive: false, canCrop: false }]) {
    const waiting = nextStep({ ...value, ...role }); assert.equal(waiting.kind, 'waiting'); assert.match(waiting.title, /acceptance|lab.*review/i);
  }
  const corrected = asset('corrected-8x10');
  value.slots[0] = { ...value.slots[0], colourAsset: corrected, colourCompletedAt: STAMP, finalAsset: corrected };
  assert.deepEqual([nextStep(value).kind, nextStep(value).slotId], ['final_review', '8x10']);
  const noColour = job(); noColour.slots[0] = { ...value.slots[0], colourAsset: null, colourCompletedAt: null, finalAsset: value.slots[0].cropAsset };
  assert.equal(nextStep(noColour).kind, 'final_review', 'Disabled colour review does not introduce a colour task');
});

test('the next actionable print is preferred over another role’s waiting print', () => {
  const photographer = reviewed({ ...withoutReceiver });
  photographer.slots[1].finalReviewedAt = null;
  photographer.slots[2] = slot('5x7-b');
  photographer.holds = ['final_review_5x7-a', 'crop_5x7-b', 'final_review_5x7-b'];
  assert.deepEqual([nextStep(photographer).kind, nextStep(photographer).slotId], ['crop', '5x7-b']);
  const receiver = reviewed({ canCrop: false, canApproveOrder: false, policy: { ...POLICY, labColourCorrection: true } });
  receiver.slots[0] = slot('8x10'); receiver.slots[1].colourCompletedAt = null; receiver.slots[1].colourAsset = null; receiver.slots[1].finalReviewedAt = null;
  receiver.holds = ['crop_8x10', 'colour_8x10', 'final_review_8x10', 'colour_5x7-a', 'final_review_5x7-a'];
  assert.deepEqual([nextStep(receiver).kind, nextStep(receiver).slotId], ['colour', '5x7-a']);
});

test('each production transition and Windows handoff follows its exact stage and receiving permission', () => {
  const cases = [
    [{ status: 'accepted', dispatchState: 'idle' }, 'prepare'],
    [{ status: 'accepted', dispatchState: 'idle', canReceive: false }, 'waiting'],
    [{ status: 'in_production', dispatchState: 'idle' }, 'handoff'],
    [{ status: 'in_production', dispatchState: 'idle', canReceive: false }, 'waiting'],
    [{ status: 'in_production', dispatchState: 'claimed' }, 'waiting'],
    [{ status: 'ready', dispatchState: 'claimed' }, 'waiting'],
    [{ status: 'in_production', dispatchState: 'handed_off' }, 'ready'],
    [{ status: 'in_production', dispatchState: 'handed_off', canReceive: false }, 'waiting'],
    [{ status: 'ready', dispatchState: 'idle' }, 'complete'],
    [{ status: 'ready', dispatchState: 'handed_off' }, 'complete'],
    [{ status: 'ready', dispatchState: 'handed_off', canReceive: false }, 'waiting'],
    [{ status: 'in_production', dispatchState: 'printed' }, 'blocked'],
    [{ status: 'completed', dispatchState: 'handed_off' }, 'done'],
  ];
  for (const [patch, expected] of cases) { const value = reviewed(patch); assert.equal(nextStep(value).kind, expected, JSON.stringify(patch)); assert.equal(value.printAllowed, false); }
  assert.match(nextStep(reviewed({ dispatchState: 'claimed' })).description, /not.*confirmed.*received/i);
  assert.match(nextStep(reviewed({ status: 'completed' })).description, /does not confirm physical printing/i);
});

test('incomplete evidence never suggests a production transition even on a ready or handed-off job', () => {
  for (const patch of [{ status: 'accepted' }, { status: 'in_production' }, { status: 'ready' }, { status: 'in_production', dispatchState: 'handed_off' }, { status: 'ready', dispatchState: 'handed_off' }]) {
    for (const missing of ['hold', 'photographer', 'current-final']) {
      const value = reviewed(patch);
      if (missing === 'hold') value.holds = ['final_review_5x7-b'];
      if (missing === 'photographer') value.photographerApproved = false;
      if (missing === 'current-final') value.slots[2].finalAsset = asset('stale-final');
      assert.equal(reviewComplete(value), false);
      assert(!['prepare', 'handoff', 'ready', 'complete'].includes(nextStep(value).kind), `${JSON.stringify(patch)} with missing ${missing}`);
    }
  }
  const malformed = reviewed(); malformed.slots[2].id = '5x7-a'; assert.equal(nextStep(malformed).kind, 'blocked');
});

function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
test('guidance is pure, stable and leaves saved reviews, financial values and test-only flags untouched', () => {
  const value = reviewed({ policy: { ...POLICY, labColourCorrection: true } }), before = JSON.stringify(value);
  deepFreeze(value);
  for (let i = 0; i < 3; i++) { shortReference(value.reference); nextStep(value); reviewComplete(value); for (const item of value.slots) printStage(value, item); }
  assert.equal(JSON.stringify(value), before);
  assert.equal(value.subtotalMinor, 8550); assert.equal(value.printAllowed, false); assert.equal(value.payment, 'test_no_payment');
});

test('the action matrix never recommends a command outside its permission, saved stage or dispatch boundary', () => {
  const roles = [
    { name: 'in-house owner', canReceive: true, canApproveOrder: true, canCrop: true, responsibility: 'photographer' },
    { name: 'partner photographer', canReceive: false, canApproveOrder: true, canCrop: true, responsibility: 'photographer' },
    { name: 'lab awaiting photographer crops', canReceive: true, canApproveOrder: false, canCrop: false, responsibility: 'photographer' },
    { name: 'lab assigned crops', canReceive: true, canApproveOrder: false, canCrop: true, responsibility: 'lab' },
    { name: 'read-only viewer', canReceive: false, canApproveOrder: false, canCrop: false, responsibility: 'photographer' },
  ];
  for (const role of roles) for (const status of ['submitted', 'accepted', 'in_production', 'ready', 'completed']) for (const dispatchState of ['idle', 'claimed', 'handed_off', 'printed']) for (const progress of ['fresh', 'saved-crop', 'colour', 'final', 'done']) for (const photographerApproved of [false, true]) {
    const value = progress === 'done' ? reviewed() : job();
    Object.assign(value, { status, dispatchState, photographerApproved, canReceive: role.canReceive, canApproveOrder: role.canApproveOrder, canCrop: role.canCrop });
    value.policy.cropResponsibility = role.responsibility;
    if (progress !== 'fresh' && progress !== 'done') {
      value.slots = IDS.map(id => {
        const crop = asset(`matrix-crop-${id}`);
        return slot(id, { cropAsset: crop, cropApproved: progress !== 'saved-crop', cropApprovedAt: progress === 'saved-crop' ? null : STAMP, finalAsset: progress === 'colour' ? null : crop });
      });
      if (progress === 'colour') value.policy.labColourCorrection = true;
    }
    if (!photographerApproved) value.holds.push('photographer_approval');
    const next = nextStep(value), editable = dispatchState === 'idle' && ['submitted', 'accepted'].includes(status);
    const context = `${role.name}, ${status}, ${dispatchState}, ${progress}, approved=${photographerApproved}, next=${next.kind}`;
    const selected = value.slots.find(item => item.id === next.slotId);
    switch (next.kind) {
      case 'approve_order': assert(editable && value.canApproveOrder && !photographerApproved, context); break;
      case 'accept': assert(dispatchState === 'idle' && status === 'submitted' && value.canReceive, context); break;
      case 'crop': case 'approve_crop': assert(editable && value.canCrop && selected && printStage(value, selected) === next.kind, context); break;
      case 'colour': case 'final_review': assert(dispatchState === 'idle' && status === 'accepted' && value.canReceive && selected && printStage(value, selected) === next.kind, context); break;
      case 'prepare': assert(dispatchState === 'idle' && status === 'accepted' && value.canReceive && reviewComplete(value), context); break;
      case 'handoff': assert(dispatchState === 'idle' && status === 'in_production' && value.canReceive && reviewComplete(value), context); break;
      case 'ready': assert(dispatchState === 'handed_off' && status === 'in_production' && value.canReceive && reviewComplete(value), context); break;
      case 'complete': assert(['idle', 'handed_off'].includes(dispatchState) && status === 'ready' && value.canReceive && reviewComplete(value), context); break;
      case 'done': assert.equal(status, 'completed', context); break;
      case 'waiting': case 'blocked': break;
      default: assert.fail(context);
    }
  }
});
