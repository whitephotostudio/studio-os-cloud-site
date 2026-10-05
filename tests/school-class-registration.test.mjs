import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as personalization from '../lib/school-gallery-email-personalization.ts';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schoolId = '11111111-1111-4111-8111-111111111111';
const photographerId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
function load(path, dependencies) {
  const output = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:') || name === 'zod') return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }, exports);
  return exports;
}
const next = { NextResponse: { json: (data, options) => Response.json(data, options) } };
function fixture({ enabled = false, status = 'pre_release', classes = ['Grade 7', 'Grade 12'], owner = true, contactError = false, registrationError = false, matchingPin = true } = {}) {
  const calls = [], sent = [], rpcCalls = [];
  const schedule = { shootDates: ['2026-10-05', '2026-10-26', '2026-11-02'], slotMinutes: 10 };
  const school = { id: schoolId, photographer_id: photographerId, school_name: 'School', status, registration_class_required: enabled, gallery_settings: { schedule, share: {}, extras: { sendEmailCampaign: false } } };
  const tables = {
    schools: [school], photographers: [{ id: photographerId, user_id: 'owner', studio_email: 'studio@example.com' }],
    students: matchingPin ? [{ id: studentId, school_id: schoolId, pin: '12345', photo_url: 'ready.jpg' }] : [],
    pre_release_registrations: [], pre_release_emails: [], portal_email_captures: [], school_gallery_visitors: [], school_student_email_contacts: [],
  };
  const service = {
    from(table) {
      let predicate = () => true, operation = 'read', value;
      const query = {
        select() { return query; },
        eq(key, expected) { const prev = predicate; predicate = row => prev(row) && row[key] === expected; return query; },
        insert(nextValue) { operation = 'insert'; value = nextValue; return query; },
        upsert(nextValue) { operation = 'upsert'; value = nextValue; return query; },
        update(nextValue) { operation = 'update'; value = nextValue; return query; },
        maybeSingle() { return run(true); },
        then(ok, err) { return run(false).then(ok, err); },
      };
      async function run(single) {
        calls.push({ table, operation, value });
        if (table === 'school_student_email_contacts' && contactError) return { error: { message: 'unavailable' }, data: null };
        if (table === 'pre_release_registrations' && registrationError) return { error: { code: 'XX000' }, data: null };
        if (!(table in tables)) throw Error(`Unexpected table ${table}`);
        if (operation === 'insert' || operation === 'upsert') tables[table].push(value);
        const rows = tables[table].filter(predicate);
        if (operation === 'update') rows.forEach(row => Object.assign(row, value));
        return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
      }
      return query;
    },
    async rpc(name, args) { rpcCalls.push({ name, args }); return { data: null, error: registrationError ? { code: 'XX000' } : null }; },
  };
  const dependencies = {
    'next/server': next,
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service, resolveDashboardAuth: async () => ({ user: owner ? { id: 'owner' } : null }) },
    '@/lib/rate-limit': { getClientIp: () => 'local', rateLimit: async () => ({ allowed: true }) },
    '@/lib/school-registration-classes': { schoolRegistrationClasses: async () => classes },
    '@/lib/require-agreement': { guardAgreement: async () => ({ ok: true }) },
    '@/lib/api-validation': { parseJson: async (req, schema) => { const parsed = schema.safeParse(await req.json()); return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: Response.json({ ok: false }, { status: 400 }) }; } },
    '@/lib/audit': { recordAudit: async () => {}, diffFields: () => ({ before: {}, after: {} }) },
    '@/lib/event-gallery-settings': { normalizeEventGallerySettings: v => v ?? { extras: {}, share: {} }, sanitizeEventGallerySettingsForClient: v => v },
    '@/lib/event-gallery-email': { buildSchoolShareEmail: () => ({ subject: 'Ready', html: 'ready', text: 'ready' }), eventFromName: () => 'Studio', eventReplyTo: () => 'studio@example.com' },
    '@/lib/project-email-deliveries': { hasProjectEmailDelivery: async () => false, recordProjectEmailDelivery: async () => {} },
    '@/lib/resend': { resendConfigured: () => true, sendResendEmail: async v => { sent.push(v); return { id: 'mock' }; } },
    '@/lib/school-email-recipients': { collectSchoolRecipientEmails: async () => ['parent@example.com'] },
    '@/lib/ensure-package-profile': {},
    '@/lib/calendar-dates': { hasCalendarBoundaryPassed: () => false },
  };
  for (const key of ['checkout-tax', 'school-gallery-downloads', 'storage-images', 'backdrop-media-references', 'private-media-references', 'package-profile-selection', 'storage-folder', 'school-sync', 'school-photo-deletions', 'school-composite-scope', 'school-portal-media', 'school-order-media']) dependencies[`@/lib/${key}`] = {};
  const req = data => ({ url: 'https://example.test/api', json: async () => data });
  return { tables, school, schedule, calls, sent, rpcCalls, dependencies, req, context: { params: Promise.resolve({ schoolId }) } };
}

test('existing school and project email-only registration works with class feature off', async () => {
  const f = fixture(); const route = load('app/api/portal/pre-release-register/route.ts', f.dependencies);
  assert.equal((await route.POST(f.req({ schoolId, email: ' PARENT@example.com ' }))).status, 200);
  assert.deepEqual(f.tables.pre_release_registrations, [{ school_id: schoolId, email: 'parent@example.com' }]);
  assert.equal((await route.POST(f.req({ projectId: schoolId, email: 'student@example.com' }))).status, 200);
  assert.equal(f.tables.pre_release_emails.length, 1); assert.equal(f.rpcCalls.length, 0);
});
test('enabled class registration enforces roster choices; validation failure never writes success', async () => {
  const f = fixture({ enabled: true }); const route = load('app/api/portal/pre-release-register/route.ts', f.dependencies);
  for (const classNames of [undefined, [], ['Invented class']]) {
    assert.equal((await route.POST(f.req({ schoolId, email: 'parent@example.com', classNames }))).status, 400);
  }
  assert.equal(f.rpcCalls.length, 0);
  assert.equal((await route.POST(f.req({ schoolId, email: 'parent@example.com', classNames: ['Grade 7', 'Grade 12', 'Grade 7'] }))).status, 200);
  assert.deepEqual(f.rpcCalls[0].args.p_classes, ['Grade 7', 'Grade 12']);
  assert.equal(f.calls.filter(c => c.table === 'students').length, 0);
});
test('class registration remains available after the first photo day goes live', async () => {
  const f = fixture({ enabled: true, status: 'active' }); const route = load('app/api/portal/pre-release-register/route.ts', f.dependencies);
  assert.equal((await route.POST(f.req({ schoolId, email: 'parent@example.com', classNames: ['Grade 12'] }))).status, 200);
});
test('a registration storage failure is reported to the parent', async () => {
  const f = fixture({ enabled: true, registrationError: true }); const route = load('app/api/portal/pre-release-register/route.ts', f.dependencies);
  const response = await route.POST(f.req({ schoolId, email: 'parent@example.com', classNames: ['Grade 7'] }));
  assert.equal(response.status, 500); assert.equal((await response.json()).ok, false);
});
test('school release keeps old automatic emails off-toggle, but enabled class mode sends none automatically', async () => {
  for (const enabled of [false, true]) {
    const f = fixture({ enabled }); const route = load('app/api/dashboard/schools/[schoolId]/route.ts', f.dependencies);
    const response = await route.PATCH(f.req({ status: 'active' }), f.context);
    assert.equal(response.status, 200); assert.equal(f.sent.length, enabled ? 0 : 1);
    assert.deepEqual(f.school.gallery_settings.schedule, f.schedule);
    assert.ok(f.calls.every(c => !['bookings', 'booking_events', 'booking_slots'].includes(c.table)));
    assert.equal(f.school.registration_class_required, enabled);
  }
});
test('toggle alone does not send email, change schedule, or silently enable schools without a roster', async () => {
  const f = fixture({ status: 'active' }); const route = load('app/api/dashboard/schools/[schoolId]/route.ts', f.dependencies);
  assert.equal((await route.PATCH(f.req({ registration_class_required: true }), f.context)).status, 200);
  assert.equal(f.school.registration_class_required, true); assert.equal(f.sent.length, 0);
  assert.deepEqual(f.school.gallery_settings.schedule, f.schedule);
  assert.equal((await route.PATCH(f.req({ registration_class_required: false }), f.context)).status, 200);
  assert.equal(f.school.registration_class_required, false); assert.equal(f.sent.length, 0);
  const empty = fixture({ classes: [] });
  assert.equal((await load('app/api/dashboard/schools/[schoolId]/route.ts', empty.dependencies).PATCH(empty.req({ registration_class_required: true }), empty.context)).status, 400);
  assert.equal(empty.school.registration_class_required, false);
  const anon = fixture({ owner: false });
  assert.equal((await load('app/api/dashboard/schools/[schoolId]/route.ts', anon.dependencies).PATCH(anon.req({ registration_class_required: true }), anon.context)).status, 401);
});
test('a failed notification contact write never blocks a valid PIN login; invalid PIN creates no contact', async () => {
  const f = fixture({ enabled: true, status: 'active', contactError: true });
  const route = load('app/api/portal/school-access/route.ts', f.dependencies);
  assert.equal((await route.POST(f.req({ schoolId, email: 'parent@example.com', pin: '12345' }))).status, 200);
  const legacy = fixture({ status: 'active' });
  assert.equal((await load('app/api/portal/school-access/route.ts', legacy.dependencies).POST(legacy.req({ schoolId, email: 'parent@example.com', pin: '12345' }))).status, 200);
  assert.equal(legacy.calls.filter(c => c.table === 'school_student_email_contacts').length, 0);
  const invalid = fixture({ enabled: true, status: 'active', matchingPin: false });
  assert.equal((await load('app/api/portal/school-access/route.ts', invalid.dependencies).POST(invalid.req({ schoolId, email: 'parent@example.com', pin: 'invalid' }))).status, 404);
  assert.equal(invalid.calls.filter(c => c.table === 'school_student_email_contacts').length, 0);
});
test('schema defaults preserve old schools and sibling class registrations accumulate without changing student data', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table schools(id uuid primary key, school_name text);
      create table students(id uuid primary key, school_id uuid references schools(id), pin text, parent_email text);
      create table pre_release_registrations(id uuid default gen_random_uuid() primary key, school_id uuid references schools(id), email text, unique(school_id,email));
      insert into schools values('${schoolId}','School');
      insert into students values('${studentId}','${schoolId}','12345','original@example.com');`);
    await db.exec(source('supabase/migrations/20260925020000_school_class_registration.sql'));
    assert.equal((await db.query('select registration_class_required from schools')).rows[0].registration_class_required, false);
    for (const classes of [['Grade 7'], ['Grade 12'], ['Grade 7'], []]) {
      await db.query('select register_school_email_classes($1,$2,$3)', [schoolId, 'parent@example.com', classes]);
    }
    const registrations = (await db.query('select email,class_names from pre_release_registrations')).rows;
    assert.equal(registrations.length, 1); assert.deepEqual(registrations[0].class_names.sort(), ['Grade 12', 'Grade 7']);
    assert.deepEqual((await db.query('select pin,parent_email from students')).rows[0], { pin: '12345', parent_email: 'original@example.com' });
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select register_school_email_classes($1,$2,$3)', [schoolId, 'other@example.com', ['Grade 7']]), /permission denied/);
      await assert.rejects(db.query('select * from school_student_email_contacts'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
test('class migration has its own version and does not collide with the owner overview', () => {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(n => n.startsWith('20260925020000'));
  assert.equal(versions.length, 1);
});


test('class email API rejects stale audiences and foreign schools; explicit custom addresses never widen a class send', async () => {
  const f = fixture({ enabled: true, status: 'active' });
  const fingerprint = 'a'.repeat(64);
  const inputs = [];
  Object.assign(f.dependencies, {
    '@/lib/school-gallery-email-personalization': personalization,
    '@/lib/school-class-email-audience': { loadSchoolClassEmailAudience: async (...args) => {
      inputs.push(args.slice(1));
      return { unknownClasses: [], fingerprint, deliveries: [{ recipientEmail: 'selected@example.com', bookingId: null, studentId, studentName: 'Selected', studentPin: '12345' }] };
    } },
    '@/lib/studio-booking-email-send': { sendStudioBookingEmailWithRetry: async value => { f.sent.push(value); return { id: 'mock' }; } },
  });
  const route = load('app/api/dashboard/schools/[schoolId]/emails/route.ts', f.dependencies);
  const body = { action: 'campaign', recipientMode: 'classes', classNames: ['Grade 7'], onlyWithPhotos: true, audienceFingerprint: fingerprint, requestId: studentId, recipients: ['outside@example.com'], ccRecipients: ['copy@example.com'] };
  assert.equal((await route.POST(f.req({ ...body, audienceFingerprint: 'b'.repeat(64) }), f.context)).status, 409);
  assert.equal(f.sent.length, 0);
  assert.equal((await route.POST(f.req(body), { params: Promise.resolve({ schoolId: photographerId }) })).status, 404);
  assert.equal(f.sent.length, 0);
  assert.equal((await route.POST(f.req(body), f.context)).status, 200);
  assert.equal((await route.POST(f.req(body), f.context)).status, 200);
  assert.deepEqual(f.sent.map(row => row.to), ['selected@example.com', 'selected@example.com']);
  assert.equal(f.sent[0].idempotencyKey, f.sent[1].idempotencyKey);
  assert.deepEqual(inputs.at(-1), [schoolId, ['Grade 7'], true, true]);
});

test('all 718 students are considered across pages and audience refresh changes its fingerprint', async () => {
  const students = Array.from({ length: 718 }, (_, i) => ({ id: `s${i}`, school_id: schoolId, class_name: i < 500 ? 'Grade 7' : 'Grade 12', pin: String(10000 + i), parent_email: `parent${i}@example.com`, photo_url: 'ready.jpg', role: 'Student' }));
  students.push({ id: 'foreign', school_id: 'other-school', class_name: 'Foreign class', parent_email: 'foreign@example.com' });
  const pages = [];
  const service = { from(table) {
    let chosenSchool;
    const query = { select() { return query; }, eq(key, value) { assert.equal(key, 'school_id'); chosenSchool = value; return query; }, order() { return query; }, async range(start, end) { pages.push({ table, start, end }); return { data: (table === 'students' ? students : []).filter(row => row.school_id === chosenSchool).slice(start, end + 1), error: null }; } };
    return query;
  } };
  const classes = load('lib/school-registration-classes.ts', {});
  assert.deepEqual(await classes.schoolRegistrationClasses(service, schoolId), ['Grade 7', 'Grade 12']);
  const loader = load('lib/school-class-email-audience.ts', { '@/lib/school-gallery-email-personalization': personalization });
  const first = await loader.loadSchoolClassEmailAudience(service, schoolId, ['Grade 12'], true);
  assert.equal(first.deliveries.length, 218);
  assert.ok(pages.some(row => row.table === 'students' && row.start === 500));
  students[717].photo_url = null;
  const changed = await loader.loadSchoolClassEmailAudience(service, schoolId, ['Grade 12'], true);
  assert.equal(changed.deliveries.length, 217); assert.notEqual(first.fingerprint, changed.fingerprint);
});

test('parent form renders required classes only for enabled schools and keeps PIN access for live galleries', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const runtime = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) }, 'lucide-react': require('lucide-react') };
  function component(path, dependencies) {
    const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const exports = {};
    new Function('require', 'exports', compiled)(name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; }, exports);
    return exports;
  }
  const selector = component('app/parents/SchoolRegistrationClasses.tsx', runtime);
  const form = component('app/parents/SchoolDirectLoginForm.tsx', { ...runtime, './SchoolRegistrationClasses': selector }).default;
  const school = { id: schoolId, school_name: 'Example School', status: 'pre_release', email_required: true };
  const disabled = renderToStaticMarkup(React.createElement(form, { school }));
  assert.doesNotMatch(disabled, /Select your child/);
  const enabled = renderToStaticMarkup(React.createElement(form, { school: { ...school, registration_class_required: true } }));
  assert.match(enabled, /Select your child/); assert.match(enabled, /<select[^>]*required/);
  const active = renderToStaticMarkup(React.createElement(form, { school: { ...school, status: 'active', registration_class_required: true } }));
  assert.match(active, /View photos with PIN/); assert.match(active, /Register for photo updates/); assert.match(active, /Enter school PIN/);
});
