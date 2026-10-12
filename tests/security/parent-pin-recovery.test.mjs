import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const photographerId = '33333333-3333-4333-8333-333333333333';
const email = 'parent@example.test';

function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:') || name === 'zod') return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, exports);
  return exports;
}

const recovery = load('lib/pin-recovery.ts');
function likePattern(value) {
  let pattern = '^';
  const literal = character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) pattern += literal(value[++i]);
    else if (value[i] === '%') pattern += '.*';
    else if (value[i] === '_') pattern += '.';
    else pattern += literal(value[i]);
  }
  return new RegExp(`${pattern}$`, 'i');
}

function fixture({ parentEmail = email, registrationEmail = email, firstName = 'Fixture', lastName = 'Child', countError = null, beforeUpdate = null } = {}) {
  const calls = [];
  const tables = {
    students: [{ id: studentId, first_name: firstName, last_name: lastName, parent_email: parentEmail, school_id: schoolId,
      schools: { id: schoolId, school_name: 'Fixture school', photographer_id: photographerId } }],
    schools: [{ id: schoolId, photographer_id: photographerId }],
    photographers: [{ id: photographerId, business_name: 'Fixture studio', studio_email: 'studio@example.test' }],
    pre_release_registrations: registrationEmail ? [{ id: 'registration', school_id: schoolId, email: registrationEmail }] : [],
    pin_recovery_attempts: [], pin_recovery_tokens: [], pin_recovery_requests: [],
  };
  const service = {
    from(table) {
      const filters = [];
      let operation = 'read', value, max = Infinity, countOnly = false;
      const query = {
        select(_columns, options) { countOnly = options?.head === true; return query; },
        eq(key, expected) { filters.push(row => row[key] === expected); return query; },
        is(key, expected) { return query.eq(key, expected); },
        gte(key, expected) { filters.push(row => row[key] >= expected); return query; },
        gt(key, expected) { filters.push(row => row[key] > expected); return query; },
        ilike(key, expected) { const pattern = likePattern(expected); filters.push(row => pattern.test(row[key])); return query; },
        limit(nextMax) { max = nextMax; return query; },
        insert(nextValue) { operation = 'insert'; value = nextValue; return query; },
        update(nextValue) { operation = 'update'; value = nextValue; return query; },
        maybeSingle() { return run(true); },
        then(resolve, reject) { return run(false).then(resolve, reject); },
      };
      async function run(single) {
        calls.push({ table, operation, countOnly });
        if (countOnly && countError && filters.some(filter => filter(countError.row))) {
          return { data: null, error: { message: 'Counter unavailable' }, count: null };
        }
        if (operation === 'insert') {
          tables[table].push({ id: `${table}-${tables[table].length}`, ...(table === 'pin_recovery_tokens' ? { used_at: null } : {}), ...value });
          return { data: null, error: null };
        }
        if (operation === 'update') beforeUpdate?.(tables);
        const rows = tables[table].filter(row => filters.every(filter => filter(row))).slice(0, max);
        if (operation === 'update') rows.forEach(row => Object.assign(row, value));
        return { data: structuredClone(single ? rows[0] ?? null : rows), error: null, count: rows.length };
      }
      return query;
    },
  };
  const input = { email: registrationEmail || email, firstName: firstName.toLowerCase(), lastName: lastName.toLowerCase(), schoolId,
    ipAddress: '192.0.2.1', userAgent: 'fixture' };
  return { tables, service, input, calls };
}

test('school-wide registration cannot recover a student without a trusted roster email', async () => {
  for (const parentEmail of [null, '', '   ']) {
    const f = fixture({ parentEmail, registrationEmail: 'unrelated@example.test' });
    const result = await recovery.runRecoveryDoorCheck(f.service, f.input);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'photographer_fallback');
    assert.equal(f.tables.pin_recovery_tokens.length, 0);
  }
});

test('matching trusted roster email receives a random hashed recovery token; unrelated email cannot', async () => {
  const allowed = fixture({ parentEmail: ' PARENT@example.test ' });
  const result = await recovery.runRecoveryDoorCheck(allowed.service, allowed.input);
  assert.equal(result.ok, true);
  assert.equal(Buffer.from(result.plaintextToken, 'base64url').length, 32);
  assert.equal(allowed.tables.pin_recovery_tokens[0].token_hash, recovery.hashToken(result.plaintextToken));
  assert.equal(allowed.tables.pin_recovery_tokens[0].parent_email, email);
  assert.equal(JSON.stringify(allowed.tables.pin_recovery_tokens).includes(result.plaintextToken), false);
  const denied = fixture({ registrationEmail: 'unrelated@example.test' });
  assert.equal((await recovery.runRecoveryDoorCheck(denied.service, denied.input)).reason, 'email_mismatch');
  assert.equal(denied.tables.pin_recovery_tokens.length, 0);
});

test('names and registration emails treat SQL LIKE wildcards as literal characters', async () => {
  for (const names of [{ firstName: '%', lastName: '%' }, { firstName: 'F_xt_re', lastName: 'Ch_ld' }]) {
    const f = fixture();
    assert.equal((await recovery.runRecoveryDoorCheck(f.service, { ...f.input, ...names })).reason, 'no_student_match');
    assert.equal(f.tables.pin_recovery_tokens.length, 0);
  }
  const literal = fixture({ firstName: 'Fi%xt_ure\\', lastName: 'Child_100%' });
  assert.equal((await recovery.runRecoveryDoorCheck(literal.service, literal.input)).ok, true);
  const registration = fixture({ parentEmail: 'parent%tag@example.test', registrationEmail: 'parent-other-tag@example.test' });
  assert.equal((await recovery.runRecoveryDoorCheck(registration.service, { ...registration.input, email: 'parent%tag@example.test' })).reason, 'email_not_registered');
});

test('recovery fails closed when durable rate counters cannot be read', async () => {
  const f = fixture({ countError: { row: { ip_address: '192.0.2.1', created_at: new Date().toISOString() } } });
  assert.equal((await recovery.runRecoveryDoorCheck(f.service, f.input)).reason, 'internal_error');
  assert.equal(f.tables.pin_recovery_tokens.length, 0);
});

function tokenFixture(options = {}) {
  const f = fixture(options), plaintextToken = 'local-fixture-recovery-token';
  f.tables.pin_recovery_tokens.push({ id: 'token', token_hash: recovery.hashToken(plaintextToken), student_id: studentId,
    photographer_id: photographerId, parent_email: email, expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null });
  return { ...f, args: { plaintextToken, ipAddress: '192.0.2.1', userAgent: 'fixture' } };
}

test('two concurrent claims consume a recovery token once', async () => {
  const f = tokenFixture();
  const results = await Promise.all([recovery.claimRecoveryToken(f.service, f.args), recovery.claimRecoveryToken(f.service, f.args)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok && result.reason === 'already_used').length, 1);
  assert.equal((await recovery.claimRecoveryToken(f.service, f.args)).reason, 'already_used');
});

test('previous automatic tokens cannot recover missing/mismatched roster emails or a transferred student', async () => {
  for (const parentEmail of [null, 'different@example.test']) {
    const f = tokenFixture({ parentEmail });
    assert.equal((await recovery.claimRecoveryToken(f.service, f.args)).reason, 'not_found');
    assert.equal(f.tables.pin_recovery_tokens[0].used_at, null);
  }
  const moved = tokenFixture(); moved.tables.students[0].schools.photographer_id = 'different-studio';
  assert.equal((await recovery.claimRecoveryToken(moved.service, moved.args)).reason, 'not_found');
});

test('manual recovery requires the approved request to bind the same student, photographer, and email', async () => {
  const valid = () => {
    const f = tokenFixture({ parentEmail: null });
    f.tables.pin_recovery_tokens[0].manual_request_id = 'manual';
    f.tables.pin_recovery_requests.push({ id: 'manual', status: 'approved', student_id: studentId, photographer_id: photographerId, parent_email: email });
    return f;
  };
  const allowed = valid();
  assert.equal((await recovery.claimRecoveryToken(allowed.service, allowed.args)).ok, true);
  for (const changes of [{ status: 'pending' }, { student_id: 'other' }, { photographer_id: 'other' }, { parent_email: 'other@example.test' }]) {
    const denied = valid(); Object.assign(denied.tables.pin_recovery_requests[0], changes);
    assert.equal((await recovery.claimRecoveryToken(denied.service, denied.args)).reason, 'not_found');
    assert.equal(denied.tables.pin_recovery_tokens[0].used_at, null);
  }
});

test('expired, invalid-expiry, and tokens expiring during consumption grant no access', async () => {
  for (const expiresAt of ['invalid', new Date(Date.now() - 1).toISOString()]) {
    const f = tokenFixture(); f.tables.pin_recovery_tokens[0].expires_at = expiresAt;
    assert.equal((await recovery.claimRecoveryToken(f.service, f.args)).reason, 'expired');
    assert.equal(f.tables.pin_recovery_tokens[0].used_at, null);
  }
  const raced = tokenFixture({ beforeUpdate: tables => { tables.pin_recovery_tokens[0].expires_at = new Date(Date.now() - 1).toISOString(); } });
  assert.equal((await recovery.claimRecoveryToken(raced.service, raced.args)).ok, false);
});

function requestRoute(f, outcome) {
  const sent = [], composed = [];
  const route = load('app/api/portal/recovery/request/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => f.service },
    '@/lib/api-validation': { parseJson: async (request, schema) => ({ ok: true, data: schema.parse(await request.json()) }) },
    '@/lib/pin-recovery': { pinRecoveryOrigin: recovery.pinRecoveryOrigin, runRecoveryDoorCheck: async () => outcome, logRecoveryAttempt: async () => {} },
    '@/lib/pin-recovery-email': { buildPinRecoveryEmail: options => { composed.push(options); return { subject: 'Fixture', html: options.recoveryUrl, text: options.recoveryUrl }; } },
    '@/lib/resend': { sendResendEmail: async options => { sent.push(options); } },
  });
  const request = () => new Request('https://www.studiooscloud.com/api/portal/recovery/request', { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example.test', host: 'attacker.example.test' },
    body: JSON.stringify({ schoolId, email, firstName: 'Fixture', lastName: 'Child' }) });
  return { route, sent, composed, request };
}

test('recovery emails ignore caller Origin/Host and only use a configured HTTPS origin', async t => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
  const outcome = { ok: true, plaintextToken: 'local-fixture-token', student: { id: studentId, firstName: 'Fixture', lastName: 'Child', schoolName: 'Fixture school' },
    photographer: { id: photographerId, businessName: 'Fixture', studioEmail: 'studio@example.test' } };
  for (const configured of [undefined, 'http://insecure.example.test', 'https://user:password@configured.example.test', 'not a URL']) {
    if (configured === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = configured;
    const f = requestRoute(fixture(), outcome);
    assert.equal((await f.route.POST(f.request())).status, 200);
    assert.equal(new URL(f.composed[0].recoveryUrl).origin, 'https://www.studiooscloud.com');
    assert.equal(f.sent.length, 1);
  }
  process.env.NEXT_PUBLIC_SITE_URL = 'https://configured.example.test/some-path?unused=1';
  const f = requestRoute(fixture(), outcome);
  await f.route.POST(f.request());
  assert.equal(new URL(f.composed[0].recoveryUrl).origin, 'https://configured.example.test');
  assert.equal(new URL(f.composed[0].recoveryUrl).pathname, '/api/portal/recovery/claim');
});

test('missing trusted student email queues photographer assistance without issuing an email or token', async () => {
  const fixtureState = fixture({ parentEmail: null });
  const outcome = await recovery.runRecoveryDoorCheck(fixtureState.service, fixtureState.input);
  const f = requestRoute(fixtureState, outcome);
  const response = await f.route.POST(f.request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(f.sent.length, 0);
  assert.equal(fixtureState.tables.pin_recovery_tokens.length, 0);
  assert.equal(fixtureState.tables.pin_recovery_requests.length, 1);
  assert.equal(fixtureState.tables.pin_recovery_requests[0].status, 'pending');
});

test('photographer-approved recovery emails also ignore attacker Origin headers', async t => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.studiooscloud.com';
  const f = fixture({ parentEmail: null });
  const requestId = '44444444-4444-4444-8444-444444444444';
  f.tables.photographers[0].user_id = 'owner-user';
  f.tables.pin_recovery_requests.push({ id: requestId, status: 'pending', school_id: schoolId, photographer_id: photographerId, parent_email: email });
  const composed = [], sent = [];
  const route = load('app/api/dashboard/admin/recovery/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => f.service, resolveDashboardAuth: async () => ({ user: { id: 'owner-user' } }) },
    '@/lib/api-validation': { parseJson: async (request, schema) => ({ ok: true, data: schema.parse(await request.json()) }) },
    '@/lib/pin-recovery': recovery,
    '@/lib/pin-recovery-email': { buildPinRecoveryEmail: options => { composed.push(options); return { subject: 'Fixture', html: 'Fixture', text: 'Fixture' }; } },
    '@/lib/resend': { sendResendEmail: async options => { sent.push(options); } },
  });
  const response = await route.POST(new Request('https://www.studiooscloud.com/api/dashboard/admin/recovery', { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example.test' },
    body: JSON.stringify({ action: 'approve', requestId, studentId }) }));
  assert.equal(response.status, 200);
  assert.equal(new URL(composed[0].recoveryUrl).origin, 'https://www.studiooscloud.com');
  assert.equal(sent.length, 1);
  const args = { plaintextToken: new URL(composed[0].recoveryUrl).searchParams.get('token'), ipAddress: '192.0.2.1', userAgent: 'fixture' };
  assert.equal((await recovery.claimRecoveryToken(f.service, args)).ok, true);
});

test('recovery claim redirects keep the recovered PIN on the configured origin', async t => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; });
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.studiooscloud.com';
  const f = fixture(); f.tables.students[0].pin = 'fixture-pin';
  const route = load('app/api/portal/recovery/claim/route.ts', {
    'next/server': { NextResponse: { redirect: url => Response.redirect(url, 307) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => f.service },
    '@/lib/pin-recovery': { pinRecoveryOrigin: recovery.pinRecoveryOrigin, claimRecoveryToken: async () => ({ ok: true, studentId }) },
  });
  const request = new Request('https://attacker.example.test/api/portal/recovery/claim?token=fixture');
  request.nextUrl = new URL(request.url);
  const response = await route.GET(request);
  const destination = new URL(response.headers.get('location'));
  assert.equal(destination.origin, 'https://www.studiooscloud.com');
  assert.equal(destination.searchParams.get('pin'), 'fixture-pin');
});
