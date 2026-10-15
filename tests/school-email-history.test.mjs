import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const schoolId = '11111111-1111-4111-8111-111111111111';
const photographerId = '22222222-2222-4222-8222-222222222222';
const checkpointType = 'school_deadline_reminder_run';

function fixture(history, { ignoreHistoryFilter = false } = {}) {
  const reads = [];
  const tables = {
    photographers: [{ id: photographerId, user_id: 'owner', studio_email: 'studio@example.test' }],
    schools: [{ id: schoolId, photographer_id: photographerId }],
    bookings: [], students: [], project_email_deliveries: history,
  };
  const service = { from(table) {
    const predicates = [];
    let ordering, rowLimit;
    const query = {
      select() { return query; },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      neq(key, value) {
        reads.push({ table, exclusion: { key, value } });
        if (!ignoreHistoryFilter) predicates.push(row => row[key] !== value);
        return query;
      },
      contains(key, value) { predicates.push(row => Object.entries(value).every(([field, expected]) => row[key]?.[field] === expected)); return query; },
      order(key, options) { ordering = { key, ascending: options.ascending }; return query; },
      limit(value) { rowLimit = value; return query; },
      maybeSingle() { return execute(true); },
      then(resolve, reject) { return execute(false).then(resolve, reject); },
    };
    async function execute(single) {
      reads.push({ table, rowLimit });
      let rows = tables[table].filter(row => predicates.every(predicate => predicate(row)));
      if (ordering) rows = rows.toSorted((left, right) => String(left[ordering.key]).localeCompare(String(right[ordering.key])) * (ordering.ascending ? 1 : -1));
      if (rowLimit !== undefined) rows = rows.slice(0, rowLimit);
      return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
    }
    return query;
  } };
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: 'owner' } }), createDashboardServiceClient: () => service },
    '@/lib/api-validation': {}, '@/lib/event-gallery-email': {}, '@/lib/event-gallery-settings': {},
    '@/lib/project-email-deliveries': {}, '@/lib/studio-booking-email-send': {}, '@/lib/require-agreement': {}, '@/lib/school-class-email-audience': {},
    '@/lib/resend': { listRecentResendEmailStatuses: async () => [] },
    '@/lib/school-email-recipients': { collectSchoolRecipientEmails: async () => [] },
    '@/lib/school-gallery-email-personalization': {
      buildIndependentRosterEmailRows: () => [], buildSchoolGalleryEmailDeliveries: () => [], excludeCancelledOnlyRecipientEmails: rows => rows,
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/api/dashboard/schools/[schoolId]/emails/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const route = {};
  new Function('require', 'exports', code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:') || name === 'zod') return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }, route);
  return { reads, get: () => route.GET({ url: 'https://example.test/api/school/emails' }, { params: Promise.resolve({ schoolId }) }) };
}

function delivery(id, overrides = {}) {
  return { id, photographer_id: photographerId, recipient_email: `${id}@example.test`, email_type: 'school-deadline-reminder',
    resend_email_id: `provider-${id}`, subject: 'Order deadline', status: 'sent', payload: { schoolId }, error_message: null,
    sent_at: '2026-10-18T13:00:00.000Z', ...overrides };
}

test('internal reminder runs never consume the 50-email history window or appear as sent emails', async () => {
  const checkpoints = Array.from({ length: 60 }, (_, index) => delivery(`checkpoint-${index}`, {
    email_type: checkpointType, resend_email_id: null, status: ['pending', 'missed', 'blocked', 'cancelled', 'completed'][index % 5],
    sent_at: `2026-10-19T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  const f = fixture([...checkpoints, delivery('accepted'), delivery('rejected', { status: 'failed', resend_email_id: null, error_message: 'Provider rejected this email.' }),
    delivery('foreign-school', { payload: { schoolId: 'different-school' } }), delivery('foreign-owner', { photographer_id: 'another-owner' })]);
  const response = await f.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.deliveryReport.map(row => [row.id, row.statusLabel]), [['accepted', 'Sent'], ['rejected', 'Failed']]);
  assert.ok(f.reads.some(row => row.table === 'project_email_deliveries' && row.exclusion?.key === 'email_type' && row.exclusion.value === checkpointType));
  assert.ok(f.reads.some(row => row.table === 'project_email_deliveries' && row.rowLimit === 50));
});

test('delivery report defensively omits a reminder run even if the history source returns it', async () => {
  const f = fixture([delivery('checkpoint', { email_type: checkpointType, status: 'missed', resend_email_id: null }), delivery('accepted')], { ignoreHistoryFilter: true });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).deliveryReport.map(row => row.id), ['accepted']);
});
