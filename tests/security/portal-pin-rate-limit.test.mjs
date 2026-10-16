import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before, after, beforeEach } from 'node:test';
import ts from 'typescript';
import { harness, projectId, lockedAlbum } from '../helpers/event-gallery-harness.mjs';
import { localPinBudgetRedis } from '../helpers/pin-budget-redis.mjs';

const require = createRequire(import.meta.url);
const secret = 'synthetic-test-secret';
const scope = { kind: 'event', galleryId: projectId, pin: 'project-pin', email: 'viewer@example.test' };
// CI installs Ubuntu Redis; locally use `brew install redis`. No app runtime
// service is installed: tests start only a private UNIX socket with port 0.
let redis, fixtureNumber=0;
before(async()=>{redis=await localPinBudgetRedis();});
after(async()=>{await redis?.close();});
beforeEach(async()=>{const within=Date.now()%60000;if(within>50000)await new Promise(resolve=>setTimeout(resolve,60005-within));});
function fixture({ unavailable = false, now, malformed = false, noEnv = false } = {}) {
  const calls = [], ip=`192.0.2.${++fixtureNumber}`;
  class Clock extends Date { static now() { return now; } }
  const source = readFileSync(new URL('../../lib/portal-pin-rate-limit.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  class SharedRedis {
    constructor(config){assert.equal(config.retry.retries,0);assert.ok(config.signal() instanceof AbortSignal);}
    async eval(script,keys,args){calls.push({script,keys,args});if(unavailable)throw Error('synthetic outage');if(malformed)return 'not-an-atomic-result';return redis.eval(script,keys,args);}
  }
  new Function('require', 'exports', 'process', 'Date', output)(name => {
    if (name === '@/lib/rate-limit') return { getClientIp: request => request.headers.get('x-real-ip') || ip };
    if (name === '@upstash/redis') return {Redis:SharedRedis};
    return require(name);
  }, exports, { env: { EVENT_DOWNLOAD_TOKEN_SECRET: secret, NODE_ENV: 'production',...(!noEnv?{UPSTASH_REDIS_REST_URL:'https://synthetic.invalid',UPSTASH_REDIS_REST_TOKEN:'synthetic'}:{}) } }, now===undefined?Date:Clock);
  const request = (path, body = { projectId, pin: scope.pin, email: scope.email }, cookie = '', method = 'POST') => {
    const url = new URL(`https://www.studiooscloud.com/api/portal/${path}`);
    if (method === 'GET') for (const [key, value] of Object.entries(body)) url.searchParams.set(key, value);
    return new Request(url, { method, headers: { cookie, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  };
  const cookieFor = async (credential = scope) => (await exports.grantPortalPinBudget(new Response(), request('event-access'), credential)).headers.get('set-cookie')?.split(';')[0] || '';
  return { ...exports, calls, request, cookieFor };
}

test('switching between every PIN validator shares the same attempt counter', async () => {
  const f = fixture();
  const paths = ['event-access', 'event-gallery-context', 'event-download-ready', 'event-downloads', 'event-favorites',
    'orders/create', 'orders/history', 'orders/dismiss', 'school-access', 'gallery-context', 'school-downloads', 'school-favorites', 'yearbook'];
  for (let i = 0; i < paths.length; i += 1) {
    const body = paths[i].startsWith('school') || paths[i] === 'gallery-context' || paths[i] === 'yearbook'
      ? { schoolId: projectId, email: scope.email, pin: scope.pin } : undefined;
    const result = await f.portalPinAttemptLimit(f.request(paths[i], body));
    assert.equal(result?.status ?? null, i < 10 ? null : 429, paths[i]);
  }
  assert.equal(new Set(f.calls.map(call => call.keys[0])).size, 1);
  assert.equal(await redis.command('GET',f.calls[0].keys[0]),'10');
  assert.equal(await redis.command('GET',f.calls[0].keys[1]),'10');
});

test('valid proof permits rapid authorized interactions but cannot authorize a different PIN, gallery, email, or scope', async () => {
  const f = fixture(), cookie = await f.cookieFor();
  for (let i = 0; i < 150; i += 1) {
    assert.equal(await f.portalPinAttemptLimit(f.request('event-favorites', undefined, cookie)), null);
  }
  assert.equal(f.calls.length, 0);
  for (const changed of [{ pin: 'different' }, { projectId: lockedAlbum }, { email: 'other@example.test' }, { schoolId: projectId, projectId: '' }]) {
    await f.portalPinAttemptLimit(f.request('event-gallery-context', { projectId, pin: scope.pin, email: scope.email, ...changed }, cookie));
  }
  assert.equal(f.calls.length, 4);
});

test('proof cookies are private, signed and contain no PIN or email', async () => {
  const f = fixture(), response = await f.grantPortalPinBudget(new Response(), f.request('event-access'), scope);
  const raw = response.headers.get('set-cookie');
  assert.match(raw, /HttpOnly/); assert.match(raw, /Secure/); assert.match(raw, /SameSite=Lax/); assert.match(raw, /Path=\/api\/portal/);
  const [encoded, mac] = raw.split(';')[0].split('=')[1].split('.');
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  assert.equal(decoded.includes(scope.pin), false); assert.equal(decoded.includes(scope.email), false);
  const tampered = `studio_os_parent_pin_budget=${encoded}.${mac.slice(0, -1)}${mac.endsWith('0') ? '1' : '0'}`;
  await f.portalPinAttemptLimit(f.request('event-favorites', undefined, tampered));
  assert.equal(f.calls.length, 1);
});

test('expired proof, missing proof, malformed scope, and limiter outage fail safely', async () => {
  const old = fixture({ now: Date.now() - 7 * 60 * 60 * 1000 }), f = fixture();
  await f.portalPinAttemptLimit(f.request('event-favorites', undefined, await old.cookieFor()));
  await f.portalPinAttemptLimit(f.request('event-favorites', undefined, 'studio_os_parent_pin_budget=invalid'));
  assert.equal(f.calls.length, 2);
  assert.equal(await f.cookieFor({ ...scope, galleryId: 'malformed' }), '');
  assert.equal(await f.cookieFor({ ...scope, email: 'malformed' }), '');
  const outage = fixture({ unavailable: true });
  assert.equal((await outage.portalPinAttemptLimit(outage.request('event-gallery-context'))).status, 503);
  assert.equal(await outage.portalPinAttemptLimit(outage.request('event-favorites', undefined, await outage.cookieFor())), null);
  for(const options of [{malformed:true},{noEnv:true}]){const f=fixture(options);assert.equal((await f.portalPinAttemptLimit(f.request('event-access'))).status,503);}
});

test('GET favorites and combined sibling orders cannot bypass the shared PIN budget', async () => {
  const f = fixture(), cookie = await f.cookieFor();
  assert.equal(await f.portalPinAttemptLimit(f.request('event-favorites', undefined, cookie, 'GET')), null);
  const groups = [{ projectId, pin: scope.pin, email: scope.email }, { schoolId: lockedAlbum, pin: 'sibling-pin', email: scope.email }];
  for (let i = 0; i < 11; i += 1) {
    const result = await f.portalPinAttemptLimit(f.request('orders/create-combined', { groups }, cookie));
    assert.equal(result?.status ?? null, i < 10 ? null : 429);
  }
  const topLevel = fixture();
  for (let i = 0; i < 11; i += 1) {
    const result = await topLevel.portalPinAttemptLimit(topLevel.request('event-gallery-context', { projectId, pin: 'guess', email: scope.email, groups: [] }));
    assert.equal(result?.status ?? null, i < 10 ? null : 429, 'extra groups cannot suppress top-level PIN');
  }
});

test('duplicate GET credentials and extra gallery aliases cannot redirect a valid budget proof', async () => {
  const f = fixture(), cookie = await f.cookieFor();
  for (const field of ['pin', 'email', 'projectId', 'schoolId', 'eventId']) {
    const request = f.request('event-favorites', undefined, cookie, 'GET');
    const url = new URL(request.url);
    if (!url.searchParams.has(field)) url.searchParams.append(field, projectId);
    url.searchParams.append(field, field === 'pin' ? 'guessed-pin' : 'different');
    const result = await f.portalPinAttemptLimit(new Request(url, { headers: { cookie } }));
    assert.equal(result.status, 400, field);
  }
  const otherProject = '99999999-9999-4999-8999-999999999999';
  for (const fields of [
    { projectId: otherProject, eventId: projectId },
    { projectId, schoolId: projectId },
    { projectId, eventId: otherProject },
  ]) {
    await f.portalPinAttemptLimit(f.request('event-favorites', { ...fields, pin: scope.pin, email: scope.email }, cookie));
  }
  assert.equal(f.calls.length, 3, 'every actual and extra scope must be covered before exemption');
});

test('real concurrent Redis reservations admit exactly ten pending validations across both shared windows',async()=>{
  const f=fixture(),requests=Array.from({length:25},()=>f.request('event-access'));
  const results=await Promise.all(requests.map(request=>f.portalPinAttemptLimit(request)));
  assert.equal(results.filter(value=>value===null).length,10);assert.equal(results.filter(value=>value?.status===429).length,15);
  const keys=f.calls[0].keys;
  assert.equal(await redis.command('GET',keys[0]),'10');assert.equal(await redis.command('GET',keys[1]),'10');
  assert.ok((await redis.command('PTTL',keys[0]))>0);assert.ok((await redis.command('PTTL',keys[1]))>0);
});

test('fresh successful parents on one WiFi refund their own atomic reservation while failed guesses stay charged',async()=>{
  const f=fixture();
  for(let index=0;index<70;index++){
    const credential={...scope,pin:`valid-${index}`,email:`parent${index}@example.test`};
    const request=f.request('event-access',{projectId,pin:credential.pin,email:credential.email});
    assert.equal(await f.portalPinAttemptLimit(request),null);
    await f.grantPortalPinBudget(new Response(),request,credential);
  }
  const keys=f.calls[0].keys;
  assert.equal(await redis.command('GET',keys[0]),'0');assert.equal(await redis.command('GET',keys[1]),'0');
  for(let index=0;index<10;index++)assert.equal(await f.portalPinAttemptLimit(f.request('event-favorites',{projectId,pin:`guess-${index}`,email:scope.email})),null);
  assert.equal((await f.portalPinAttemptLimit(f.request('event-gallery-context'))).status,429);
  assert.equal(await redis.command('GET',keys[0]),'10');assert.equal(await redis.command('GET',keys[1]),'10');
});

test('refund identity is bound to exact IP, route, method and complete scope list and is consumed only once',async()=>{
  const f=fixture(),request=f.request('event-access');
  assert.equal(await f.portalPinAttemptLimit(request),null);
  const token=f.portalPinReservationHeader(request),header=f.PORTAL_PIN_RESERVATION_HEADER,keys=f.calls[0].keys;
  const forward=(path='event-access',extra={})=>{const req=f.request(path,undefined,'',extra.method||'POST');req.headers.set(header,token);if(extra.ip)req.headers.set('x-real-ip',extra.ip);return req;};
  for(const [req,credential] of [[forward('event-favorites'),scope],[forward('event-access',{ip:'192.0.2.250'}),scope],[forward('event-access',{method:'GET'}),scope],[forward(),{...scope,pin:'other'}],[forward(),{...scope,galleryId:lockedAlbum}]])assert.equal(await f.refundPortalPinAttempt(req,credential),false);
  assert.equal(await redis.command('GET',keys[0]),'1');
  const decoded=Buffer.from(token.split('.')[0],'base64url').toString('utf8');
  assert.ok(!decoded.includes(scope.pin)&&!decoded.includes(scope.email)&&!decoded.includes('192.0.2.'));
  assert.equal(await f.refundPortalPinAttempt(forward(),scope),true);
  assert.equal(await f.refundPortalPinAttempt(forward(),scope),false);
  assert.equal(await redis.command('GET',keys[0]),'0');assert.equal(await redis.command('GET',keys[1]),'0');
  const sibling={kind:'school',galleryId:lockedAlbum,pin:'sibling',email:scope.email};
  const combined=f.request('orders/create-combined',{groups:[{projectId,pin:scope.pin,email:scope.email},{schoolId:sibling.galleryId,pin:sibling.pin,email:sibling.email}]});
  assert.equal(await f.portalPinAttemptLimit(combined),null);
  assert.equal(await f.refundPortalPinAttempt(combined,scope),false,'partial combined authorization cannot refund');
  assert.equal(await f.refundPortalPinAttempt(combined,[sibling,scope]),true);
});

test('long-window denial is atomic and old-window refunds cannot subtract a later window',async()=>{
  const f=fixture(),first=f.request('event-access');assert.equal(await f.portalPinAttemptLimit(first),null);
  const keys=f.calls[0].keys;
  await redis.command('SET',keys[0],'0');await redis.command('SET',keys[1],'60');
  assert.equal((await f.portalPinAttemptLimit(f.request('event-access'))).status,429);
  assert.equal(await redis.command('GET',keys[0]),'0','long denial never increments short window');
  const nextShort=keys[0].replace(/\d+$/,value=>String(Number(value)+1));
  const nextLong=keys[1].replace(/\d+$/,value=>String(Number(value)+1));
  await redis.command('SET',nextShort,'7');await redis.command('SET',nextLong,'9');await redis.command('DEL',keys[0],keys[1]);
  assert.equal(await f.refundPortalPinAttempt(first,scope),true);
  assert.equal(await redis.command('GET',nextShort),'7');assert.equal(await redis.command('GET',nextLong),'9');
  assert.equal(await redis.command('EXISTS',keys[0],keys[1]),0);
});

test('real concurrent refund replay consumes exactly one reservation and preserves another failed attempt',async()=>{
  const f=fixture(),failed=f.request('event-access',{projectId,pin:'failed-guess',email:scope.email}),success=f.request('event-access');
  assert.equal(await f.portalPinAttemptLimit(failed),null);assert.equal(await f.portalPinAttemptLimit(success),null);
  const results=await Promise.all(Array.from({length:20},()=>f.refundPortalPinAttempt(success,scope)));
  assert.equal(results.filter(Boolean).length,1);
  const keys=f.calls[0].keys;assert.equal(await redis.command('GET',keys[0]),'1');assert.equal(await redis.command('GET',keys[1]),'1');
});

test('corrupted shared counter values fail closed before either window changes',async()=>{
  const f=fixture(),first=f.request('event-access');assert.equal(await f.portalPinAttemptLimit(first),null);
  const keys=f.calls[0].keys;
  for(const value of ['invalid','1.5','-1']){
    await redis.command('SET',keys[0],'3');await redis.command('SET',keys[1],value);
    assert.equal((await f.portalPinAttemptLimit(f.request('event-access'))).status,503);
    assert.equal(await redis.command('GET',keys[0]),'3');assert.equal(await redis.command('GET',keys[1]),value);
  }
});

test('expired and forged reservation headers never refund, and proof cookies are not refund tokens',async()=>{
  const f=fixture(),request=f.request('event-access');assert.equal(await f.portalPinAttemptLimit(request),null);
  const token=f.portalPinReservationHeader(request),old=fixture({now:Date.now()+121000});
  const expired=old.request('event-access');expired.headers.set('x-real-ip',`192.0.2.${fixtureNumber-1}`);expired.headers.set(f.PORTAL_PIN_RESERVATION_HEADER,token);
  assert.equal(await old.refundPortalPinAttempt(expired,scope),false);
  const forged=f.request('event-access');forged.headers.set(f.PORTAL_PIN_RESERVATION_HEADER,token.slice(0,-1)+(token.endsWith('0')?'1':'0'));
  assert.equal(await f.refundPortalPinAttempt(forged,scope),false);
  forged.headers.set(f.PORTAL_PIN_RESERVATION_HEADER,(await f.cookieFor()).split('=')[1]);assert.equal(await f.refundPortalPinAttempt(forged,scope),false);
  assert.equal(await redis.command('GET',f.calls[0].keys[0]),'1');
});

test('actual proxy replaces caller reservation headers and uses only the store-validated general API key',async()=>{
  const f=fixture(),forwarded=[],general=[];
  const source=readFileSync(new URL('../../proxy.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  const NextResponse={json:Response.json,next:({request})=>{forwarded.push(request.headers);return new Response();}};
  new Function('require','exports','process',output)(name=>{
    if(name==='next/server')return{NextResponse};
    if(name==='@/lib/portal-pin-rate-limit')return f;
    if(name==='@/lib/rate-limit')return{getClientIp:()=> 'synthetic-proxy-ip',rateLimit:async(key,config)=>{general.push({key,config});return{allowed:true};}};
    if(name==='@/lib/labs/pilot')return{labPilotRequested:()=>false,isLabPilot:()=>false};
    if(name==='@/lib/parent-gallery-session')return{parentSessionRateBudgetKey:async request=>request.headers.get('x-synthetic-registered-lane')==='yes'?'parent-session:validated-test-key':null};
    if(name==='@/lib/content-security-policy')return{contentSecurityPolicy:()=>"default-src 'self'"};
    return require(name);
  },exports,{env:{NODE_ENV:'production'}});
  async function invoke(request){request.nextUrl=new URL(request.url);request.headers.set(f.PORTAL_PIN_RESERVATION_HEADER,'attacker-value');return exports.proxy(request);}
  const raw=f.request('event-access');await invoke(raw);
  const reservation=forwarded.at(-1).get(f.PORTAL_PIN_RESERVATION_HEADER);assert.ok(reservation&&reservation!=='attacker-value');
  const authorized=f.request('event-favorites',undefined,await f.cookieFor());authorized.headers.set('x-synthetic-registered-lane','yes');await invoke(authorized);
  assert.equal(forwarded.at(-1).has(f.PORTAL_PIN_RESERVATION_HEADER),false);
  assert.equal(general.at(-1).key,'parent-session:validated-test-key');
  for(const path of ['session','unrelated']){await invoke(f.request(path,path==='session'?{kind:'event',galleryId:projectId,pin:scope.pin,email:scope.email}:{}));assert.equal(forwarded.at(-1).has(f.PORTAL_PIN_RESERVATION_HEADER),false);}
  assert.equal(general.at(-1).key,'synthetic-proxy-ip');
});

test('validated context issues proof and locked album slugs cannot load or mutate favorites', async () => {
  const h = harness();
  const invalid = await h.post('app/api/portal/event-gallery-context/route.ts', h.body({ pin: 'incorrect' }));
  assert.equal(invalid.status, 404); assert.equal(invalid.headers.get('set-cookie'), null);
  const valid = await h.post('app/api/portal/event-gallery-context/route.ts');
  assert.equal(valid.status, 200); assert.match(valid.headers.get('set-cookie'), /HttpOnly/);
  for (const method of ['GET', 'POST']) {
    const request = new Request(`https://www.studiooscloud.com/api/portal/event-favorites?projectId=${projectId}&pin=guessable-slug&email=viewer@example.test`, {
      method, ...(method === 'POST' ? { body: JSON.stringify(h.body({ pin: 'guessable-slug' })), headers: { 'content-type': 'application/json' } } : {}),
    });
    request.nextUrl = new URL(request.url);
    const response = await h.load('app/api/portal/event-favorites/route.ts')[method](request);
    assert.equal(response.status, 404, method);
  }
});

test('actual event context refunds a validated PIN and retains a wrong-PIN charge',async()=>{
  const f=fixture(),h=harness({overrides:{'@/lib/portal-pin-rate-limit':f}});
  async function guarded(pin){
    const incoming=f.request('event-gallery-context',{projectId,pin,email:scope.email});
    assert.equal(await f.portalPinAttemptLimit(incoming),null);
    const headers=new Headers(incoming.headers);headers.set(f.PORTAL_PIN_RESERVATION_HEADER,f.portalPinReservationHeader(incoming));
    const forwarded=new Request(incoming.clone(),{headers});forwarded.nextUrl=new URL(forwarded.url);
    return h.load('app/api/portal/event-gallery-context/route.ts').POST(forwarded);
  }
  const success=await guarded(scope.pin);assert.equal(success.status,200);assert.ok(success.headers.get('set-cookie'));
  const keys=f.calls[0].keys;assert.equal(await redis.command('GET',keys[0]),'0');assert.equal(await redis.command('GET',keys[1]),'0');
  const failed=await guarded('incorrect');assert.equal(failed.status,404);assert.equal(failed.headers.get('set-cookie'),null);
  assert.equal(await redis.command('GET',keys[0]),'1');assert.equal(await redis.command('GET',keys[1]),'1');
});
