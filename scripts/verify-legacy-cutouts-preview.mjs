import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const PROJECT = 'bwqhzczxoevouiondjak';
const BUCKET = 'studio-os-downloads';
const INPUT = 'release-audit/credit-legacy-input-20260930.json';
const OUTPUT = 'release-audit/credit-legacy-verified-20260930.json';
const hash = b => createHash('sha256').update(b).digest('hex');
const safeKey = k => typeof k === 'string' && k.length <= 1024 && !k.startsWith('/') && !/[\\\x00-\x1f\x7f?#]/.test(k) && k.split('/').every(s => s && s !== '.' && s !== '..');
const maxBytes = 25 * 1024 * 1024;

export async function matchesOriginal(original, output) {
  const cut = sharp(output, { failOn: 'error', limitInputPixels: 64000000 });
  const meta = await cut.metadata();
  if (meta.format !== 'png' || !meta.hasAlpha || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) return false;
  const [rgba, rgb] = await Promise.all([
    cut.resize(128,128,{fit:'fill'}).ensureAlpha().raw().toBuffer(),
    sharp(original,{failOn:'error',limitInputPixels:64000000}).rotate().resize(128,128,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer(),
  ]);
  if (rgba.length !== 128*128*4 || rgb.length !== 128*128*3) return false;
  let foreground = 0, matching = 0, error = 0, transparent = 0;
  for (let p=0;p<128*128;p++) {
    if (rgba[p*4+3] < 250) transparent++;
    if (rgba[p*4+3] < 245) continue;
    foreground++;
    const diff = (Math.abs(rgba[p*4]-rgb[p*3])+Math.abs(rgba[p*4+1]-rgb[p*3+1])+Math.abs(rgba[p*4+2]-rgb[p*3+2]))/3;
    error += diff; if (diff < 32) matching++;
  }
  return foreground > 200 && transparent > 100 && matching/foreground >= .9 && error/foreground < 12;
}

export async function verifyLegacyCutoutsPreview(env = process.env) {
  if (env.STUDIO_LEGACY_CUTOUT_AUDIT !== '1') return;
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'codex/credit-system-audit-20260929' || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${PROJECT}.supabase.co`) throw Error('Legacy audit requires exact authorized Preview and database.');
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const bucket = await sb.storage.getBucket(BUCKET); if(bucket.error || bucket.data.public)throw Error('Private audit storage required.');
  const input = await sb.storage.from(BUCKET).download(INPUT); if(input.error || input.data.size > 32*1024*1024)throw Error('Audit input unavailable.');
  const i = JSON.parse(await input.data.text());
  if(i.projectRef!==PROJECT || !i.completed || !Number.isFinite(Date.parse(i.capturedAt)))throw Error('Inventory authority mismatch.');
  const r2 = new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
  const r2bucket=env.R2_BUCKET_NAME||'whitephoto-media';
  const readR2 = async (key, etag) => {
    if(!safeKey(key))throw Error('Unsafe inventory key');
    const r=await r2.send(new GetObjectCommand({Bucket:r2bucket,Key:key,...(etag?{IfMatch:etag}:{})}),{abortSignal:AbortSignal.timeout(20000)});
    if(!r.Body || !r.ContentLength || r.ContentLength>maxBytes){r.Body?.destroy?.();throw Error('Read budget');}
    const b=await r.Body.transformToByteArray();if(b.length!==r.ContentLength)throw Error('Incomplete read');return Buffer.from(b);
  };
  const objects=[];let token;
  for(let n=0;n<20;n++) {
    const r=await r2.send(new ListObjectsV2Command({Bucket:r2bucket,Prefix:'nobg-photos/',MaxKeys:1000,ContinuationToken:token}),{abortSignal:AbortSignal.timeout(20000)});
    objects.push(...(r.Contents||[]).map(o=>({key:o.Key,etag:o.ETag,size:o.Size,updatedAt:o.LastModified?.toISOString(),backend:'r2'})));
    if(!r.IsTruncated)break;token=r.NextContinuationToken;if(n===19)throw Error('Inventory listing budget');
  }
  for(const o of i.supabaseCutoutObjects) {
    const canonical=`nobg-photos/${o.key}`;
    if(!objects.some(r=>r.key===canonical))objects.push({key:canonical,storageKey:o.key,size:o.size,updatedAt:o.updatedAt,backend:'supabase'});
  }
  const owners=[...new Set(i.galleryOriginalReferences.map(r=>r.scope.photographerId))];
  const p=await sb.from('photographers').select('id,user_id').in('id',owners);
  const [schoolResult,projectResult]=await Promise.all([
    sb.from('schools').select('id,photographer_id,local_school_id').in('id',i.scopes.schools.map(s=>s.id)),
    sb.from('projects').select('id,photographer_id').in('id',i.scopes.projects.map(s=>s.id)),
  ]);
  if(p.error||schoolResult.error||projectResult.error)throw Error('Scope recheck failed');
  const ownerUsers=new Map((p.data??[]).map(p=>[p.id,p.user_id]));
  const scopes=new Map([...(schoolResult.data??[]).map(s=>[`school:${s.id}`,s.photographer_id]),...(projectResult.data??[]).map(s=>[`project:${s.id}`,s.photographer_id])]);
  const rows=[];const held=[];const cache=new Map();
  const originalBytes=async(ref)=>{
    const id=`${ref.source}:${ref.bucket||''}:${ref.key}`;
    if(!cache.has(id))cache.set(id,(async()=>{
      if(!safeKey(ref.key))throw Error('Unsafe original');
      if(ref.source==='supabase_storage') {
        if(!['photos','school-photos','originals','gallery-photos','thumbs'].includes(ref.bucket))throw Error('Unknown original bucket');
        const d=await sb.storage.from(ref.bucket).download(ref.key);if(d.error||d.data.size>maxBytes)throw Error('Original unavailable');return Buffer.from(await d.data.arrayBuffer());
      }
      return readR2(ref.key);
    })());
    return cache.get(id);
  };
  for(let start=0;start<objects.length;start+=4)await Promise.all(objects.slice(start,start+4).map(async(o)=>{
    const refs=i.galleryOriginalReferences.filter(r=>(o.backend==='r2'?r.r2CutoutCandidateKeys:r.supabaseCutoutCandidateKeys).includes(o.backend==='r2'?o.key:o.storageKey));
    if(!refs.length){held.push({key:o.key,reason:'No verified database original'});return;}
    const ownerIds=[...new Set(refs.map(r=>r.scope.photographerId))];
    if(ownerIds.length!==1||!ownerUsers.get(ownerIds[0])||refs.some(r=>scopes.get(`${r.scope.kind}:${r.scope.id}`)!==ownerIds[0])||Date.parse(o.updatedAt)>Date.parse(i.capturedAt)) {held.push({key:o.key,reason:'Scope or snapshot needs review'});return;}
    try {
      let out;
      if(o.backend==='r2')out=await readR2(o.key,o.etag);
      else {const d=await sb.storage.from('nobg-photos').download(o.storageKey);if(d.error||d.data.size>maxBytes)throw Error('Output unavailable');out=Buffer.from(await d.data.arrayBuffer());}
      const candidates=[...new Map(refs.map(r=>[`${r.original.source}:${r.original.bucket||''}:${r.original.key}`,r])).values()].sort((a,b)=>Number(/thumb|preview/i.test(a.original.key))-Number(/thumb|preview/i.test(b.original.key)));
      for(const ref of candidates.slice(0,16)) {
        try {const original=await originalBytes(ref.original);if(!await matchesOriginal(original,out))continue;
          rows.push({object_key:o.key,studio_id:ownerUsers.get(ownerIds[0]),photographer_id:ownerIds[0],original_sha256:hash(original),cutout_sha256:hash(out),source_key:ref.original.key,source_backend:ref.original.source,scope_kind:ref.scope.kind,scope_id:ref.scope.id,review_snapshot_at:i.capturedAt,backend:o.backend,storageKey:o.storageKey??null,bytes:out.length,etag:o.etag??null});return;
        }catch{ /* Try the next owned source representation. */ }
      }
      held.push({key:o.key,reason:'Original content match not verified'});
    }catch{held.push({key:o.key,reason:'Exact output unavailable'});}
  }));
  r2.destroy();
  const report={projectRef:PROJECT,verifiedAt:new Date().toISOString(),inventorySnapshot:i.capturedAt,rows,held,summary:{objects:objects.length,verified:rows.length,held:held.length,r2Verified:rows.filter(r=>r.backend==='r2').length,supabaseVerified:rows.filter(r=>r.backend==='supabase').length},financialMutations:0,grants:0};
  const saved=await sb.storage.from(BUCKET).upload(OUTPUT,Buffer.from(JSON.stringify(report)),{contentType:'application/json',upsert:false});if(saved.error)throw Error('Private verified audit save failed');
  console.log(JSON.stringify({check:'legacy-cutout-content-audit',...report.summary,privateReportSaved:true,financialMutations:0,grants:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)verifyLegacyCutoutsPreview().catch(()=>{console.error('Legacy cutout audit did not complete; private service details withheld.');process.exitCode=1;});
