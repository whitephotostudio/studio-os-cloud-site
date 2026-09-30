import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const schoolId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const otherBookingId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const routeSource = readFileSync(new URL('../app/api/dashboard/schools/[schoolId]/emails/route.ts', import.meta.url), 'utf8');

function fixture() {
  const sent = [];
  const rendered = [];
  const bookings = [
    { id: bookingId, school_id: schoolId, parent_email: 'late.student@example.com', access_pin: '12345', student_first_name: 'Late', student_last_name: 'Student', class_name: 'Nursing', status: 'confirmed' },
    { id: otherBookingId, school_id: schoolId, parent_email: 'other.student@example.com', access_pin: '67890', student_first_name: 'Other', student_last_name: 'Student', class_name: 'Nursing', status: 'confirmed' },
  ];
  const tables = {
    photographers: [{ id: 'photographer', user_id: 'owner', studio_email: 'studio@example.com' }],
    schools: [{ id: schoolId, school_name: 'College', photographer_id: 'photographer', gallery_settings: {} }],
    bookings,
  };
  const service = {
    from(table) {
      if (!(table in tables)) throw Error(`Unexpected table ${table}`);
      let matches = () => true;
      const query = {
        select() { return query; },
        eq(key, value) { const previous = matches; matches = row => previous(row) && row[key] === value; return query; },
        async maybeSingle() { return { data: tables[table].find(matches) ?? null, error: null }; },
      };
      return query;
    },
  };
  const dependencies = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service, resolveDashboardAuth: async () => ({ user: { id: 'owner', email: 'owner@example.com' } }) },
    '@/lib/api-validation': { parseJson: async (request, schema) => {
      const parsed = schema.safeParse(await request.json());
      return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: Response.json({ ok: false }, { status: 400 }) };
    } },
    '@/lib/event-gallery-email': {
      buildSchoolShareEmail: value => { rendered.push(value); return { subject: 'Gallery ready', html: 'message', text: 'message' }; },
      eventFromName: () => 'Studio', eventReplyTo: () => 'studio@example.com',
    },
    '@/lib/event-gallery-settings': { normalizeEventGallerySettings: () => ({ share: { emailSubject: 'Gallery ready', emailHeadline: 'Gallery', emailButtonLabel: 'View', emailMessage: 'Ready' } }) },
    '@/lib/project-email-deliveries': { recordProjectEmailDelivery: async () => {} },
    '@/lib/resend': { resendConfigured: () => true, listRecentResendEmailStatuses: async () => [] },
    '@/lib/studio-booking-email-send': { sendStudioBookingEmailWithRetry: async value => { sent.push(value); return { id: 'mock' }; } },
    '@/lib/school-email-recipients': { collectSchoolRecipientEmails: async () => { throw Error('Single send must not expand all visitors'); } },
    '@/lib/school-gallery-email-personalization': {},
    '@/lib/require-agreement': { guardAgreement: async () => ({ ok: true }) },
    '@/lib/school-class-email-audience': {},
  };
  const compiled = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === 'zod' || name.startsWith('node:')) return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }, exports);
  const context = { params: Promise.resolve({ schoolId }) };
  const post = body => exports.POST({ url: 'https://studiooscloud.example/api', json: async () => body }, context);
  return { bookings, sent, rendered, post };
}

test('selecting one booked student sends one private-PIN email despite other gallery recipients', async () => {
  const f = fixture();
  const body = { action: 'student', recipientMode: 'student', bookingId, expectedRecipientEmail: 'late.student@example.com', requestId, recipients: ['other.student@example.com'], ccRecipients: ['studio@example.com'] };
  const response = await f.post(body);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).recipients, 1);
  assert.deepEqual(f.sent.map(row => row.to), ['late.student@example.com']);
  assert.equal(f.rendered[0].studentName, 'Late Student');
  assert.equal(f.rendered[0].studentPin, '12345');
});

test('a stale review, cancelled booking, or missing email sends nothing', async () => {
  const f = fixture();
  const body = { action: 'student', recipientMode: 'student', bookingId, expectedRecipientEmail: 'old@example.com', requestId };
  assert.equal((await f.post(body)).status, 409);
  f.bookings[0].status = 'cancelled';
  assert.equal((await f.post({ ...body, expectedRecipientEmail: 'late.student@example.com' })).status, 400);
  f.bookings[0].status = 'confirmed';
  f.bookings[0].parent_email = '';
  assert.equal((await f.post({ ...body, expectedRecipientEmail: undefined })).status, 400);
  assert.equal(f.sent.length, 0);
});

test('single-student recipient mode cannot fall through to the all-visitor campaign', async () => {
  const f = fixture();
  const response = await f.post({ action: 'campaign', recipientMode: 'student', bookingId, requestId });
  assert.equal(response.status, 400);
  assert.equal(f.sent.length, 0);
});
