import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies) {
  const exports = {};
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', output)(name => name in dependencies ? dependencies[name] :
    name.startsWith('@/') ? load(`${name.slice(2)}.ts`, dependencies) : require(name), exports);
  return exports;
}
const schoolId = 'school-1', projectId = 'project-1';
const portrait = `schools/${schoolId}/Grade 7 A/Student One/portrait.jpg`;
const composite = `projects/${projectId}/composites/Grade 12 B/group.jpg`;
function fixture() {
  const tables = {
    schools: [{ id: schoolId, photographer_id: 'owner', status: 'active', gallery_settings: {} }],
    students: [{ id: 's1', school_id: schoolId, class_name: 'Grade 7 A', folder_name: 'Student One', photo_url: portrait, pin: '1111', role: 'Student' },
      { id: 's2', school_id: schoolId, class_name: 'Grade 8 A', folder_name: 'Student Two', photo_url: `schools/${schoolId}/Grade 8 A/Student Two/stale.jpg`, pin: '2222', role: 'Student' },
      { id: 's3', school_id: schoolId, class_name: 'Grade 12 B', folder_name: 'Student Three', photo_url: null, pin: '3333', role: 'Student' }],
    school_photo_deletions: [], projects: [{ id: projectId, photographer_id: 'owner', status: 'active' }],
    collections: [{ id: 'c1', project_id: projectId, kind: 'composite', title: 'Grade 12 B', access_mode: 'public' }],
    media: [{ id: 'm1', project_id: projectId, collection_id: 'c1', storage_path: composite, filename: 'Group Photo.jpg', mime_type: 'image/jpeg' }],
  };
  const objects = new Set([portrait, composite]), reads = [], listings = [];
  let failureTable, storageFailure = false;
  const service = { from(table) {
    const filters = {};
    const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, order() { return query; },
      range(start, end) { return run(start, end, false); }, maybeSingle() { return run(0, Infinity, true); } };
    async function run(start, end, single) {
      reads.push({ table, filters: { ...filters }, start });
      if (table === failureTable) return { data: null, error: { code: 'fixture_read_failure' } };
      const rows = (tables[table] || []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
      return { data: structuredClone(single ? rows[0] ?? null : rows.slice(start, end + 1)), error: null };
    }
    return query;
  } };
  const dependencies = {
    '@/lib/r2': { listR2FolderImages: async folder => {
      listings.push(folder); if (storageFailure) throw new Error('Storage could not be checked');
      return [...objects].filter(key => key.startsWith(`${folder}/`)).map(key => ({ key, name: key.split('/').at(-1), url: '' }));
    } },
    '@/lib/school-sync': { findSyncedSchoolProjectId: async () => projectId },
    '@/lib/r2-signed-urls': { r2KeyFromAnyUrl: value => value },
    '@/lib/storage-images': { extractStoragePathFromSupabaseUrl: () => null },
  };
  const { loadSchoolDeadlineReminderPhotoClasses: photoClasses } = load('lib/school-deadline-reminder-photo-classes.ts', dependencies);
  return { tables, objects, reads, listings, run: () => photoClasses(service, schoolId),
    failTable: name => { failureTable = name; }, failStorage: () => { storageFailure = true; } };
}

test('only classes with real current portraits or authorized class photos qualify; stale representative URLs do not', async () => {
  const f = fixture();
  assert.deepEqual([...(await f.run())].sort(), ['Grade 12 B', 'Grade 7 A']);
  assert.ok(f.reads.every(read => read.table !== 'students' || read.filters.school_id === schoolId));
  f.objects.delete(portrait); f.objects.delete(composite);
  assert.deepEqual([...(await f.run())], []);
});

test('tombstones, derivatives, unrelated school objects and admin/background assets cannot mark an unshot class ready', async () => {
  const f = fixture(); f.objects.delete(composite);
  f.tables.school_photo_deletions.push({ id: 'deleted', school_id: schoolId, storage_key: portrait, storage_family: 'Grade 7 A/Student One/portrait' });
  f.objects.add(`schools/${schoolId}/Grade 7 A/Student One/portrait_preview.jpg`);
  f.objects.add(`schools/${schoolId}/Grade 8 A/Student Two/stale_cutout.png`);
  f.objects.add(`schools/${schoolId}/backgrounds/Grade 8 A/background.jpg`);
  f.objects.add(`schools/${schoolId}/admin/Grade 8 A/admin.jpg`);
  f.objects.add('schools/other-school/Grade 8 A/Student Two/portrait.jpg');
  assert.deepEqual([...(await f.run())], []);
});

test('private, archived, hidden, unpublished and foreign project assets do not count as available class photos', async () => {
  for (const change of [f => { f.tables.collections[0].access_mode = 'private'; },
    f => { f.tables.collections[0].status = 'archived'; }, f => { f.tables.media[0].is_hidden = true; },
    f => { f.tables.media[0].is_published = false; }, f => { f.tables.projects[0].photographer_id = 'different-owner'; },
    f => { f.tables.media[0].storage_path = 'projects/foreign/composites/Grade 12 B/group.jpg'; },
    f => { f.tables.media[0].mime_type = 'application/pdf'; }]) {
    const f = fixture(); f.objects.delete(portrait); change(f);
    assert.deepEqual([...(await f.run())], []);
  }
});

test('unavailable gallery/store, hidden students, missing PINs and non-student records fail closed', async () => {
  for (const change of [f => { f.tables.schools[0].status = 'pre_release'; },
    f => { f.tables.schools[0].expiration_date = '2020-01-01'; },
    f => { f.tables.schools[0].gallery_settings = { extras: { enableStore: false } }; },
    f => { f.tables.students.forEach(row => { row.pin = ''; }); },
    f => { f.tables.students.forEach(row => { row.role = 'Staff'; }); },
    f => { f.tables.students.forEach(row => { row.is_hidden = true; }); }]) {
    const f = fixture(); change(f); assert.deepEqual([...(await f.run())], []);
  }
});

test('later student pages still qualify, and data/storage failures remain errors rather than empty eligibility', async () => {
  const f = fixture(); f.tables.students.unshift(...Array.from({ length: 501 }, (_, i) => ({ id: `unshot-${i}`, school_id: schoolId, class_name: 'Grade 6 A', pin: String(i), role: 'Student' })));
  assert.deepEqual([...(await f.run())].sort(), ['Grade 12 B', 'Grade 7 A']);
  assert.ok(f.reads.some(read => read.table === 'students' && read.start === 500));
  f.failTable('students'); await assert.rejects(f.run());
  const storage = fixture(); storage.failStorage(); await assert.rejects(storage.run(), /Storage could not be checked/);
});
