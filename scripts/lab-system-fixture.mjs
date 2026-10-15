/**
 * Local-only synthetic Auth/PostgREST fixture backed by the real lab migration.
 * Run: node scripts/lab-system-fixture.mjs --app
 * Sign in at the printed Next URL with owner@lab.example.test / LocalLabOnly123!
 * No production environment files, provider keys, printers or external services.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

export const LAB_FIXTURE = Object.freeze({
  owner: '11111111-1111-4111-8111-111111111111',
  otherOwner: '22222222-2222-4222-8222-222222222222',
  photographer: '33333333-3333-4333-8333-333333333333',
  otherPhotographer: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
  school: '66666666-6666-4666-8666-666666666666',
  otherProject: '77777777-7777-4777-8777-777777777777',
  lab: '88888888-8888-4888-8888-888888888888',
  productA: '99999999-9999-4999-8999-999999999999',
  productB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  admin: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  adminPhotographer: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  password: 'LocalLabOnly123!',
});
const repository = fileURLToPath(new URL('../', import.meta.url));
const migration = new URL('../supabase/migrations/20261015200000_lab_price_sheets.sql', import.meta.url);
const tokenSecret = 'synthetic-local-lab-fixture-only';
const identifier = value => {
  if (!/^[a-z_][a-z_0-9]*$/i.test(value)) throw Error('Unsupported fixture identifier');
  return '"' + value + '"';
};
const json = value => JSON.stringify(value);

export function fixtureToken(userId = LAB_FIXTURE.owner, role = 'authenticated') {
  const encode = value => Buffer.from(json(value)).toString('base64url');
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role, aal: userId === LAB_FIXTURE.admin ? 'aal2' : 'aal1', iss: 'local-lab-fixture', aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 })}`;
  return `${data}.${createHmac('sha256', tokenSecret).update(data).digest('base64url')}`;
}
function tokenClaims(token) {
  try {
    const [header, payload, signature] = token.split('.');
    const expected = createHmac('sha256', tokenSecret).update(`${header}.${payload}`).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch { return null; }
}
function fixtureUser(id) {
  if (![LAB_FIXTURE.owner, LAB_FIXTURE.otherOwner, LAB_FIXTURE.admin].includes(id)) return null;
  return { id, aud: 'authenticated', role: 'authenticated', email: id === LAB_FIXTURE.owner ? 'owner@lab.example.test' : id === LAB_FIXTURE.admin ? 'admin@lab.example.test' : 'other@lab.example.test', email_confirmed_at: '2026-10-15T00:00:00Z', confirmed_at: '2026-10-15T00:00:00Z', created_at: '2026-10-15T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], factors: id === LAB_FIXTURE.admin ? [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', factor_type: 'totp', status: 'verified', friendly_name: 'Synthetic local factor', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' }] : [] };
}

export async function createLabDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
    create table photographers(id uuid primary key,user_id uuid references auth.users(id),business_name text,is_platform_admin boolean default false,subscription_status text default 'trialing',subscription_plan_code text default 'studio');
    create table subscriptions(id uuid default gen_random_uuid(),user_id uuid,is_admin boolean default false,status text default 'trialing',plan text default 'studio');
    create table photographer_agreements(id uuid default gen_random_uuid(),user_id uuid,agreement_version text);
    create table package_profiles(id text primary key,name text,photographer_id uuid references photographers(id));
    create table packages(id uuid primary key default gen_random_uuid(),local_id text,photographer_id uuid references photographers(id),profile_id text references package_profiles(id),profile_name text,name text,description text,price_cents integer,items jsonb,active boolean default true,category text,sort_order integer);
    create table schools(id uuid primary key,photographer_id uuid references photographers(id),school_name text,package_profile_id text);
    create table projects(id uuid primary key,photographer_id uuid references photographers(id),title text,workflow_type text default 'event',package_profile_id text);
    grant select on photographers,subscriptions,photographer_agreements,schools,projects,package_profiles,packages to authenticated;
    grant all on all tables in schema public to service_role;
    insert into auth.users(id) values ('${LAB_FIXTURE.owner}'),('${LAB_FIXTURE.otherOwner}'),('${LAB_FIXTURE.admin}');
    insert into photographers(id,user_id,business_name) values ('${LAB_FIXTURE.photographer}','${LAB_FIXTURE.owner}','Local lab pilot studio'),('${LAB_FIXTURE.otherPhotographer}','${LAB_FIXTURE.otherOwner}','Other local studio');
    insert into photographers(id,user_id,business_name,is_platform_admin) values ('${LAB_FIXTURE.adminPhotographer}','${LAB_FIXTURE.admin}','Synthetic platform admin',true);
    insert into subscriptions(user_id,is_admin) values ('${LAB_FIXTURE.admin}',true);
    insert into photographer_agreements(user_id,agreement_version) values ('${LAB_FIXTURE.owner}','2026-04-v1'),('${LAB_FIXTURE.otherOwner}','2026-04-v1'),('${LAB_FIXTURE.admin}','2026-04-v1');
    insert into projects(id,photographer_id,title) values ('${LAB_FIXTURE.project}','${LAB_FIXTURE.photographer}','Portrait gallery — local fixture'),('${LAB_FIXTURE.otherProject}','${LAB_FIXTURE.otherPhotographer}','Other owner private gallery');
    insert into schools(id,photographer_id,school_name) values ('${LAB_FIXTURE.school}','${LAB_FIXTURE.photographer}','School gallery — local fixture');
  `);
  await db.exec(readFileSync(migration, 'utf8'));
  const catalogMigration = new URL('../supabase/migrations/20261015210000_lab_catalog_imports.sql', import.meta.url);
  if (existsSync(catalogMigration)) await db.exec(readFileSync(catalogMigration, 'utf8'));
  // Test-only data lives here, never in the product migration or GTA catalog.
  await db.query(`insert into studio_labs(id,slug,name,location,country_code,city,region,currency,status,intake_enabled,catalog_verified,description) values ($1,'fixture-lab','Synthetic local lab','Local fixture only','CA','Fixture city','Fixture region','CAD','active',false,true,'Generated test catalog. No real lab, provider or printer is connected.')`, [LAB_FIXTURE.lab]);
  await db.query(`insert into studio_lab_catalog(id,lab_id,category,name,size,finish,cost_cents,currency,sku,verified,active,popular,width_inches,height_inches,cost_source) values ($1,$3,'prints','Synthetic 5x7 print','5x7','Lustre',200,'CAD','SYNTHETIC-5X7',true,true,true,5,7,'lab_confirmed'),($2,$3,'prints','Synthetic 8x10 print','8x10','Lustre',400,'CAD','SYNTHETIC-8X10',true,true,true,8,10,'lab_confirmed')`, [LAB_FIXTURE.productA, LAB_FIXTURE.productB, LAB_FIXTURE.lab]);
  await db.query("insert into lab_memberships(lab_id,user_id,role) values ($1,$2,'owner')", [LAB_FIXTURE.lab, LAB_FIXTURE.owner]);
  return db;
}

/** A deliberately small PostgREST adapter; all mutations/RPCs execute real SQL. */
export async function createLabFixture({ port = 55471 } = {}) {
  const db = await createLabDatabase();
  const requests = [];
  const anonKey = fixtureToken(null, 'anon');
  const serviceKey = fixtureToken(null, 'service_role');
  let queue = Promise.resolve();
  const serial = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      response.writeHead(403); response.end('Loopback origins only'); return;
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,range,range-unit,accept-profile,content-profile');
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Expose-Headers', 'content-range');
    const send = (status, value, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(request.method === 'HEAD' ? '' : json(value));
    };
    if (request.method === 'OPTIONS') { send(200, {}); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: url.pathname });
    try {
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw Error('Fixture body too large'); }
      const body = raw ? JSON.parse(raw) : {};
      const bearer = (request.headers.authorization || '').replace(/^Bearer /i, '');
      const claims = tokenClaims(bearer);
      if (url.pathname === '/health') { send(200, { ok: true, synthetic: true, localOnly: true }); return; }
      if (url.pathname === '/auth/v1/token') {
        const user = url.searchParams.get('grant_type') === 'refresh_token'
          ? fixtureUser(body.refresh_token?.replace('fixture-refresh-', ''))
          : fixtureUser(body.email === 'owner@lab.example.test' ? LAB_FIXTURE.owner : body.email === 'other@lab.example.test' ? LAB_FIXTURE.otherOwner : body.email === 'admin@lab.example.test' ? LAB_FIXTURE.admin : '');
        if (!user || url.searchParams.get('grant_type') !== 'refresh_token' && body.password !== LAB_FIXTURE.password) { send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); return; }
        send(200, { access_token: fixtureToken(user.id), refresh_token: `fixture-refresh-${user.id}`, expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user }); return;
      }
      if (url.pathname === '/auth/v1/user') {
        const user = fixtureUser(claims?.sub);
        send(user ? 200 : 401, user || { error: 'Unauthorized' }); return;
      }
      if (url.pathname === '/auth/v1/logout') { send(200, {}); return; }
      if (!url.pathname.startsWith('/rest/v1/') || !claims) { send(401, { message: 'Fixture authentication required' }); return; }
      const data = await serial(() => db.transaction(async tx => {
        const role = ['service_role', 'authenticated', 'anon'].includes(claims.role) ? claims.role : 'anon';
        await tx.exec(`set local role ${identifier(role)}`);
        await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [claims.sub || '', role, json(claims)]);
        const resource = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
        if (resource.startsWith('rpc/')) {
          if (request.method !== 'POST') throw Error('Fixture RPC requires POST');
          const args = Object.entries(body);
          const result = await tx.query(`select ${identifier(resource.slice(4))}(${args.map(([key], index) => `${identifier(key)} => $${index + 1}`).join(',')}) as result`, args.map(([, value]) => typeof value === 'object' && value !== null ? json(value) : value));
          return { rows: result.rows[0].result, count: 1 };
        }
        const table = identifier(resource);
        const args = [];
        const where = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
          const field = identifier(key), dot = value.indexOf('.'), op = value.slice(0, dot), expected = value.slice(dot + 1);
          if (op === 'eq' || op === 'neq') { args.push(expected); where.push(`${field}${op === 'eq' ? '=' : '<>'}$${args.length}`); }
          else if (op === 'is' && ['null', 'true', 'false'].includes(expected)) where.push(`${field} is ${expected}`);
          else if (op === 'in' && expected.startsWith('(') && expected.endsWith(')')) { const values = expected.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, '')); const placeholders = values.map(v => { args.push(v); return `$${args.length}`; }); where.push(`${field} in (${placeholders.join(',')})`); }
          else throw Error(`Unsupported fixture filter: ${op}`);
        }
        const predicate = where.length ? ` where ${where.join(' and ')}` : '';
        if (request.method === 'POST' && resource === 'studio_labs') {
          const rows = Array.isArray(body) ? body : [body];
          if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('Fixture lab insert expects one object');
          const entries = Object.entries(rows[0]);
          const select = url.searchParams.get('select') || '*';
          const fields = select === '*' ? '*' : select.split(',').map(identifier).join(',');
          const result = await tx.query(`insert into ${table}(${entries.map(([key]) => identifier(key)).join(',')}) values (${entries.map((_, i) => `$${i + 1}`).join(',')}) returning ${fields}`, entries.map(([, value]) => value));
          return { rows: result.rows, count: result.rows.length };
        }
        if (['GET', 'HEAD'].includes(request.method)) {
          const select = url.searchParams.get('select') || '*';
          const fields = select === '*' ? '*' : select.split(',').map(identifier).join(',');
          const order = url.searchParams.get('order');
          const ordered = order ? ' order by ' + order.split(',').map(value => { const [field, direction = 'asc'] = value.split('.'); if (!['asc', 'desc'].includes(direction)) throw Error('Invalid fixture order'); return `${identifier(field)} ${direction}`; }).join(',') : '';
          const limit = Number(url.searchParams.get('limit') || 1000), offset = Number(url.searchParams.get('offset') || 0);
          if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid fixture page');
          const result = await tx.query(`select ${fields} from ${table}${predicate}${ordered} limit ${Math.min(limit, 1000)} offset ${offset}`, args);
          return { rows: result.rows, count: result.rows.length };
        }
        throw Error('Fixture REST writes are unsupported; application writes must use the migration RPC');
      }));
      const single = (request.headers.accept || '').includes('vnd.pgrst.object+json');
      if (single && Array.isArray(data.rows)) {
        if (data.rows.length !== 1) { send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.rows.length} rows` }); return; }
        send(200, data.rows[0]); return;
      }
      send(200, data.rows, { 'content-range': data.count ? `0-${data.count - 1}/${data.count}` : '*/0' });
    } catch (error) {
      send(error.code === '42501' ? 403 : 400, { code: error.code || 'FIXTURE_ERROR', message: error.message, details: error.detail || null, hint: error.hint || null });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const actualPort = server.address().port;
  let closing;
  return { db, server, requests, url: `http://127.0.0.1:${actualPort}`, anonKey, serviceKey,
    close: () => closing ||= (async () => { await new Promise(resolve => server.close(resolve)); await queue; await db.close(); })() };
}

async function main() {
  const options = new Set(process.argv.slice(2));
  const port = Number(process.argv.find(value => value.startsWith('--port='))?.split('=')[1] || 55471);
  const appPort = Number(process.argv.find(value => value.startsWith('--app-port='))?.split('=')[1] || 55472);
  const fixture = await createLabFixture({ port });
  console.log(`Synthetic local lab database: ${fixture.url}`);
  let app;
  if (options.has('--app')) {
    const localEnvFiles = ['.env', '.env.local', '.env.development', '.env.development.local'].filter(name => existsSync(resolve(repository, name)));
    if (localEnvFiles.length) { await fixture.close(); throw Error('Use a clean worktree without environment files for the synthetic lab fixture.'); }
    const inherited = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'USER', 'SHELL', 'TERM'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    // Webpack supports this workspace's deliberately shared node_modules symlink.
    app = spawn(process.execPath, [resolve(repository, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(appPort)], { cwd: repository, stdio: 'inherit', env: { ...inherited, NEXT_PUBLIC_SUPABASE_URL: fixture.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.anonKey, SUPABASE_SERVICE_ROLE_KEY: fixture.serviceKey } });
    app.once('exit', async code => { await fixture.close(); process.exit(code || 0); });
    // Next dev canonicalizes request.url to localhost; its same-origin guard
    // must see the same hostname in the browser Origin header.
    console.log(`Sign in: http://localhost:${appPort}/sign-in?redirect=/dashboard/labs`);
    console.log(`Synthetic account: owner@lab.example.test / ${LAB_FIXTURE.password}`);
    console.log(`Synthetic platform admin with fixture AAL2: admin@lab.example.test / ${LAB_FIXTURE.password}`);
  } else console.log('Use --app to launch actual Next with only the synthetic local Supabase configuration.');
  const stop = async () => { app?.kill('SIGTERM'); await fixture.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
