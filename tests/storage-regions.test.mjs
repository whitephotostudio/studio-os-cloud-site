import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Regional photo storage: env-driven region registry, URL recognition and
// presigning against Backblaze B2 / Wasabi / AWS endpoints next to the
// legacy Cloudflare R2 pool.

const nodeRequire = createRequire(import.meta.url);
function load(file, modules = {}, env = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', code)(name => modules[name] ?? nodeRequire(name), exports, { env });
  return exports;
}

const legacyEnv = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'r2-key', R2_SECRET_ACCESS_KEY: 'r2-secret', R2_BUCKET_NAME: 'whitephoto-media', R2_PUBLIC_URL: 'https://pub-dead.r2.dev' };
const regionalEnv = {
  ...legacyEnv,
  STORAGE_DEFAULT_REGION: 'ca',
  STORAGE_REGION_CA_ENDPOINT: 'https://s3.ca-east-006.backblazeb2.com',
  STORAGE_REGION_CA_BUCKET: 'studioos-ca',
  STORAGE_REGION_CA_ACCESS_KEY_ID: 'ca-key',
  STORAGE_REGION_CA_SECRET_ACCESS_KEY: 'ca-secret',
  STORAGE_REGION_CA_PUBLIC_URL: 'https://f006.backblazeb2.com/file/studioos-ca',
  STORAGE_REGION_US_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  STORAGE_REGION_US_BUCKET: 'studioos-us',
  STORAGE_REGION_US_ACCESS_KEY_ID: 'us-key',
  STORAGE_REGION_US_SECRET_ACCESS_KEY: 'us-secret',
  STORAGE_REGION_UK_ENDPOINT: 'https://s3.eu-west-1.wasabisys.com',
  STORAGE_REGION_UK_BUCKET: 'studioos-uk',
  STORAGE_REGION_UK_ACCESS_KEY_ID: 'uk-key',
  STORAGE_REGION_UK_SECRET_ACCESS_KEY: 'uk-secret',
  // Incomplete configurations are ignored rather than breaking the deploy.
  STORAGE_REGION_AU_ENDPOINT: 'https://s3.ap-southeast-2.wasabisys.com',
  STORAGE_REGION_AU_BUCKET: 'studioos-au',
};

function registry(env) {
  const hosts = load('lib/storage-hosts.ts');
  const regions = load('lib/storage-regions.ts', { '@/lib/storage-hosts': hosts }, env);
  const signer = load('lib/r2-signed-urls.ts', { '@/lib/storage-hosts': hosts, '@/lib/storage-regions': regions }, env);
  return { hosts, regions, signer };
}

test('legacy deployments keep the original R2 pool as the only and default region', () => {
  const { regions } = registry(legacyEnv);
  const codes = regions.listStorageRegions().map(region => region.code);
  assert.deepEqual(codes, ['r2']);
  const r2 = regions.defaultStorageRegion();
  assert.equal(r2.provider, 'r2');
  assert.equal(r2.host, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  assert.equal(r2.bucket, 'whitephoto-media');
  assert.equal(r2.signingRegion, 'auto');
  assert.deepEqual(r2.publicUrlBases, ['https://pub-dead.r2.dev']);
  assert.equal(regions.hasStorageCredentials(r2), true);
  // Unknown codes degrade to the default region instead of failing a request.
  assert.equal(regions.storageRegionForCode('us').code, 'r2');
  assert.equal(regions.storageRegionForCountry('US').code, 'r2');
  assert.equal(regions.currentStorageRegion().code, 'r2');
});

test('unconfigured environments do not presign and never crash at import', () => {
  const { regions, signer } = registry({});
  assert.equal(regions.hasStorageCredentials(regions.defaultStorageRegion()), false);
  const originalError = console.error; console.error = () => {};
  try { assert.equal(signer.r2PresignedGetUrl('projects/a/b.jpg'), ''); } finally { console.error = originalError; }
});

test('regional buckets are parsed from env with inferred provider, signing region and countries', () => {
  const originalWarn = console.warn; const warnings = []; console.warn = message => warnings.push(message);
  let regions;
  try { ({ regions } = registry(regionalEnv)); regions.listStorageRegions(); } finally { console.warn = originalWarn; }
  assert.deepEqual(regions.listStorageRegions().map(region => region.code).sort(), ['ca', 'r2', 'uk', 'us']);
  assert.ok(warnings.some(message => /AU/.test(message)), 'incomplete AU configuration is reported');
  const ca = regions.getStorageRegion('ca');
  assert.equal(ca.provider, 'b2');
  assert.equal(ca.signingRegion, 'ca-east-006');
  assert.equal(ca.host, 's3.ca-east-006.backblazeb2.com');
  assert.deepEqual(ca.countries, ['CA']);
  assert.equal(ca.label, 'Canada');
  assert.deepEqual(ca.publicUrlBases, ['https://f006.backblazeb2.com/file/studioos-ca']);
  const uk = regions.getStorageRegion('uk');
  assert.equal(uk.provider, 'wasabi');
  assert.equal(uk.signingRegion, 'eu-west-1');
  assert.deepEqual(uk.countries, ['GB', 'IE']);
  assert.equal(regions.defaultStorageRegion().code, 'ca');
  assert.equal(regions.storageRegionForCode(null).code, 'ca');
  assert.equal(regions.storageRegionForCode('US').code, 'us');
  assert.equal(regions.storageRegionForCountry('gb').code, 'uk');
  assert.equal(regions.storageRegionForCountry('FR').code, 'ca', 'unknown countries use the default region');
  assert.deepEqual(regions.selectableStorageRegions().map(region => region.code).sort(), ['ca', 'uk', 'us']);
  assert.ok(!('accessKeyId' in regions.describeStorageRegion(ca)));
});

test('request context binds storage helpers to a photographer region and falls back to the default', async () => {
  const { regions } = registry(regionalEnv);
  const us = regions.getStorageRegion('us');
  assert.equal(regions.currentStorageRegion().code, 'ca');
  await regions.runWithStorageRegion(us, async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(regions.currentStorageRegion().code, 'us');
  });
  assert.equal(regions.currentStorageRegion().code, 'ca');
  await (async () => {
    regions.enterPhotographerStorageRegion({ id: 'p', storage_region: 'uk' });
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(regions.currentStorageRegion().code, 'uk');
  })();
});

test('direct storage URLs of every provider map back to the exact object key', () => {
  const { hosts, regions, signer } = registry(regionalEnv);
  const key = 'projects/11111111-1111-4111-8111-111111111111/albums/main/photo 1.jpg';
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  const samples = {
    [`https://${'a'.repeat(32)}.r2.cloudflarestorage.com/whitephoto-media/${encoded}?X-Amz-Signature=1`]: key,
    [`https://pub-dead.r2.dev/${encoded}`]: key,
    [`https://s3.ca-east-006.backblazeb2.com/studioos-ca/${encoded}?X-Amz-Expires=300`]: key,
    [`https://studioos-ca.s3.ca-east-006.backblazeb2.com/${encoded}`]: key,
    [`https://s3.eu-west-1.wasabisys.com/studioos-uk/${encoded}`]: key,
    [`https://s3.ca-central-1.amazonaws.com/studioos-ca/${encoded}`]: key,
    ['https://cdn.example.com/whitephoto-media/photo.jpg']: '',
    ['/api/r2/img/projects/x.jpg']: '',
  };
  for (const [url, expected] of Object.entries(samples)) assert.equal(hosts.storageKeyFromUrl(url), expected, url);
  assert.equal(hosts.isDirectStorageUrl('https://s3.ca-east-006.backblazeb2.com/studioos-ca/a.jpg'), true);
  assert.equal(hosts.isDirectStorageUrl('https://pub-dead.r2.dev/a.jpg'), false, 'legacy public links are not expiring URLs');
  assert.equal(hosts.isDirectStorageUrl('https://www.studiooscloud.com/api/r2/img/a.jpg'), false);
  assert.equal(signer.r2KeyFromAnyUrl(`https://s3.ca-east-006.backblazeb2.com/studioos-ca/${encoded}?X-Amz-Expires=300`), key);
  assert.equal(signer.r2KeyFromAnyUrl(`https://www.studiooscloud.com/api/r2/img/${encoded}?mediaToken=x`), key);
  assert.equal(signer.r2KeyFromAnyUrl(key), key);
  // Only our own configured bucket endpoints identify a region.
  assert.equal(regions.storageRegionForUrl(`https://s3.ca-east-006.backblazeb2.com/studioos-ca/${encoded}`)?.code, 'ca');
  assert.equal(regions.storageRegionForUrl(`https://studioos-us.s3.us-west-004.backblazeb2.com/${encoded}`)?.code, 'us');
  assert.equal(regions.storageRegionForUrl('https://s3.ca-east-006.backblazeb2.com/someone-else/a.jpg'), null);
  assert.equal(regions.storageRegionForUrl('https://evil.example.com/studioos-ca/a.jpg'), null);
});

test('presigned URLs target the photographer region with its own credential scope', () => {
  const { regions, signer } = registry(regionalEnv);
  const key = 'schools/local-school/Grade 1/Kid Name/portrait.jpg';
  const defaultUrl = new URL(signer.r2PresignedGetUrl(key, 300));
  assert.equal(defaultUrl.host, 's3.ca-east-006.backblazeb2.com');
  assert.ok(defaultUrl.pathname.startsWith('/studioos-ca/schools/local-school/Grade%201/'));
  assert.match(defaultUrl.searchParams.get('X-Amz-Credential'), /^ca-key\/\d{8}\/ca-east-006\/s3\/aws4_request$/);
  const usUrl = new URL(signer.r2PresignedPutUrl(key, 600, { contentLength: 10, contentType: 'image/jpeg', region: regions.getStorageRegion('us') }));
  assert.equal(usUrl.host, 's3.us-west-004.backblazeb2.com');
  assert.ok(usUrl.pathname.startsWith('/studioos-us/'));
  assert.match(usUrl.searchParams.get('X-Amz-Credential'), /^us-key\/\d{8}\/us-west-004\/s3\/aws4_request$/);
  assert.equal(usUrl.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  const legacyUrl = new URL(signer.r2PresignedGetUrl(key, 300, { region: regions.getStorageRegion('r2') }));
  assert.equal(legacyUrl.host, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  assert.match(legacyUrl.searchParams.get('X-Amz-Credential'), /\/auto\/s3\/aws4_request$/);
  const batch = signer.r2PresignBatch([key, key, ''], 60, { region: regions.getStorageRegion('uk') });
  assert.equal(new URL(batch[key]).host, 's3.eu-west-1.wasabisys.com');
});

test('storage clients are created per region with provider-appropriate settings', async () => {
  const configs = [];
  const sdk = {
    S3Client: class { constructor(config) { configs.push(config); } send() { return Promise.resolve({}); } },
    PutObjectCommand: class { constructor(input) { this.input = input; } },
    GetObjectCommand: class {}, CopyObjectCommand: class {}, DeleteObjectCommand: class {}, DeleteObjectsCommand: class {}, ListObjectsV2Command: class {},
  };
  const hosts = load('lib/storage-hosts.ts');
  const regions = load('lib/storage-regions.ts', { '@/lib/storage-hosts': hosts }, regionalEnv);
  const storage = load('lib/r2.ts', { '@aws-sdk/client-s3': sdk, '@/lib/storage-regions': regions, '@/lib/r2-media-token': { signedR2MediaUrl: () => '' }, '@/lib/school-photo-deletions': { schoolPhotoFamilyForKey: () => null } }, regionalEnv);
  assert.equal(storage.R2_BUCKET, 'studioos-ca');
  assert.equal(storage.storageBucket(), 'studioos-ca');
  const same = storage.getR2Client() === storage.getR2Client();
  assert.equal(same, true, 'default client is cached');
  storage.getR2Client(regions.getStorageRegion('r2'));
  storage.getR2Client(regions.getStorageRegion('us'));
  assert.equal(configs.length, 3);
  assert.equal(configs[0].region, 'ca-east-006');
  assert.equal(configs[0].endpoint, 'https://s3.ca-east-006.backblazeb2.com');
  assert.equal(configs[0].forcePathStyle, true);
  assert.equal(configs[0].requestChecksumCalculation, 'WHEN_REQUIRED');
  assert.equal(configs[1].region, 'auto');
  assert.equal(configs[1].forcePathStyle, undefined, 'the legacy R2 client keeps its original configuration');
  assert.equal(await storage.r2Upload('projects/p/a.jpg', new Uint8Array([1]), 'image/jpeg', undefined, { region: regions.getStorageRegion('us') }), 'projects/p/a.jpg');
  const { client, bucket } = storage.storageClientFor(regions.getStorageRegion('uk'));
  assert.equal(bucket, 'studioos-uk');
  assert.ok(client);
  assert.equal(storage.hasR2Config(), true);
});

test('photographer storage lookups survive a missing storage_region column', async () => {
  const hosts = load('lib/storage-hosts.ts');
  const regions = load('lib/storage-regions.ts', { '@/lib/storage-hosts': hosts }, regionalEnv);
  const photographerStorage = load('lib/photographer-storage.ts', { '@/lib/storage-regions': regions }, regionalEnv);
  const selects = [];
  const service = { from: () => ({ select: columns => ({ eq: (field, value) => ({ maybeSingle: async () => {
    selects.push({ columns, field, value });
    if (columns.includes('storage_region')) return { data: null, error: { code: '42703', message: 'column photographers.storage_region does not exist' } };
    return { data: { id: 'photographer-1' }, error: null };
  } }) }) }) };
  const originalWarn = console.warn; console.warn = () => {};
  let result;
  try { result = await photographerStorage.selectPhotographerStorage(service, 'user_id', 'user-1'); } finally { console.warn = originalWarn; }
  assert.deepEqual(result, { data: { id: 'photographer-1' }, error: null });
  assert.deepEqual(selects.map(entry => entry.columns), ['id, storage_region', 'id']);
  const again = await photographerStorage.selectPhotographerStorage(service, 'id', 'photographer-1');
  assert.equal(again.data.id, 'photographer-1');
  assert.equal(selects.length, 3, 'the missing column is remembered for the process');
  assert.equal(photographerStorage.enterPhotographerStorage({ id: 'p', storage_region: null }).code, 'ca');
  assert.equal(photographerStorage.photographerStorageRegion({ id: 'p', storage_region: 'us' }).code, 'us');
  assert.equal(photographerStorage.storageRegionCodeForNewAccount('US'), null, 'sign-up routing stays off until enabled');
});
