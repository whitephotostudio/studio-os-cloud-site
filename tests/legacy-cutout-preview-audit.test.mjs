import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { matchesOriginal, verifyLegacyCutoutsPreview, verifyFrozenLegacyRows, recheckLegacyRelease } from '../scripts/verify-legacy-cutouts-preview.mjs';

test('frozen release readback rejects changed output, bindings and ownership without any writes',async()=>{
  const bytes=Buffer.from('verified image bytes');const sha=createHash('sha256').update(bytes).digest('hex');
  const rows=Array.from({length:251},(_,n)=>({object_key:`nobg-photos/scope/${n}.png`,studio_id:'owner',original_sha256:sha,cutout_sha256:sha,scope_kind:'school',scope_id:'scope',source_key:`photos/${n}.jpg`}));
  const report={projectRef:'bwqhzczxoevouiondjak',rows,financialMutations:0};
  const dependencies={bindings:async()=>rows,owner:async()=> 'owner',bytes:async()=>bytes};
  await verifyFrozenLegacyRows(report,dependencies);
  await assert.rejects(()=>verifyFrozenLegacyRows(report,{...dependencies,bytes:async()=>Buffer.from('overwritten')}),/output changed/);
  await assert.rejects(()=>verifyFrozenLegacyRows(report,{...dependencies,owner:async()=> 'different owner'}),/owner changed/);
  await assert.rejects(()=>verifyFrozenLegacyRows(report,{...dependencies,bindings:async()=>rows.map((r,n)=>n? r:{...r,cutout_sha256:'a'.repeat(64)})}),/binding changed/);
  await assert.rejects(()=>verifyFrozenLegacyRows({...report,rows:[...rows.slice(1),rows[1]]},dependencies),/authority mismatch/);
  await recheckLegacyRelease({});
  await assert.rejects(()=>recheckLegacyRelease({STUDIO_LEGACY_CUTOUT_RECHECK:'1',VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'}),/authorized release database/);
});

test('legacy content audit requires the exact production-backed Preview and is disabled normally',async()=>{
  await verifyLegacyCutoutsPreview({});
  for(const env of [
    {VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'codex/credit-system-audit-20260929',NEXT_PUBLIC_SUPABASE_URL:'https://bwqhzczxoevouiondjak.supabase.co'},
    {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'other',NEXT_PUBLIC_SUPABASE_URL:'https://bwqhzczxoevouiondjak.supabase.co'},
    {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/credit-system-audit-20260929',NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},
  ]) await assert.rejects(()=>verifyLegacyCutoutsPreview({...env,STUDIO_LEGACY_CUTOUT_AUDIT:'1'}),/exact authorized Preview/);
});

test('legacy match requires a visible transparent subject matching original pixels',async()=>{
  const rgb=Buffer.alloc(128*128*3,70);const rgba=Buffer.alloc(128*128*4);
  for(let p=0;p<128*128;p++)for(let c=0;c<4;c++)rgba[p*4+c]=c===3?(p%128>32&&p%128<96?255:0):70;
  const original=await sharp(rgb,{raw:{width:128,height:128,channels:3}}).png().toBuffer();
  const cutout=await sharp(rgba,{raw:{width:128,height:128,channels:4}}).png().toBuffer();
  assert.equal(await matchesOriginal(original,cutout),true);
  const wrong=await sharp({create:{width:128,height:128,channels:3,background:'#ffffff'}}).png().toBuffer();
  assert.equal(await matchesOriginal(wrong,cutout),false);
  assert.equal(await matchesOriginal(original,original),false);
  const empty=await sharp({create:{width:128,height:128,channels:4,background:{r:70,g:70,b:70,alpha:0}}}).png().toBuffer();
  assert.equal(await matchesOriginal(original,empty),false);
});
