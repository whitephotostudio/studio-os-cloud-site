import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userA = "11111111-1111-4111-8111-111111111111", userB = "22222222-2222-4222-8222-222222222222";
const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const schoolA = "33333333-3333-4333-8333-333333333333", schoolB = "44444444-4444-4444-8444-444444444444";
const student = (sourceId = "00017") => ({ sourceId, externalId: `gotphoto:${sourceId}`, firstName: "Alice", lastName: "Rivera", className: "12A", parentEmail: "parent@example.com" });
const customer = (email = "parent@example.com") => ({ fullName: "Parent Rivera", email, phone: "123" });

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create table public.photographers(id uuid primary key, user_id uuid not null references auth.users(id));
    create table public.schools(id uuid primary key, photographer_id uuid not null references public.photographers(id), unique(id,photographer_id));
    create table public.students(id uuid primary key default gen_random_uuid(), school_id uuid references public.schools(id), first_name text, last_name text,
      class_id uuid, class_name text, external_student_id text, role text, pin text, parent_email text, folder_name text, photo_url text, unique(school_id,external_student_id), unique(school_id,pin));
    create table public.crm_clients(id uuid primary key default gen_random_uuid(), photographer_id uuid references public.photographers(id), kind text, display_name text,
      default_timezone text, notes text, tags text[], created_by uuid);
    create table public.crm_contacts(id uuid primary key default gen_random_uuid(), photographer_id uuid references public.photographers(id), client_id uuid references public.crm_clients(id),
      full_name text, email text, email_normalized text generated always as (lower(btrim(email))) stored, phone text, role text, is_primary boolean,
      preferred_channel text, marketing_consent text, do_not_contact boolean, consent_source text);
    insert into auth.users values ('${userA}'),('${userB}');
    insert into public.photographers values ('${ownerA}','${userA}'),('${ownerB}','${userB}');
    insert into public.schools values ('${schoolA}','${ownerA}'),('${schoolB}','${ownerB}');`);
  await db.exec(readFileSync(new URL("../../supabase/migrations/20261008230000_gotphoto_reviewed_import.sql", import.meta.url), "utf8"));
  return db;
}
const run = (db, { user = userA, owner = ownerA, school = schoolA, key = "one-school-import", fingerprint = "a".repeat(64), students = [], contacts = [] } = {}) => db.query(
  "select public.import_reviewed_gotphoto_csv($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb,$7::jsonb) as receipt",
  [user, owner, school, key, fingerprint, JSON.stringify(students), JSON.stringify(contacts)],
);

test("SQL one-school import creates a fresh private gallery identity and a durable replay receipt", async () => {
  const db = await fixture();
  try {
    const original = await run(db, { students: [student()] });
    const retry = await run(db, { students: [student()] });
    assert.deepEqual(retry.rows[0].receipt, original.rows[0].receipt);
    assert.equal(original.rows[0].receipt.importedStudents, 1);
    assert.equal(original.rows[0].receipt.photosUploaded, 0);
    const saved = (await db.query("select * from public.students")).rows;
    assert.equal(saved.length, 1); assert.equal(saved[0].external_student_id, "gotphoto:00017");
    assert.match(saved[0].pin, /^[A-F0-9]{8}$/); assert.equal(saved[0].photo_url, null);
    assert.equal((await db.query("select count(*)::int n from gotphoto_import_requests")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("SQL refuses wrong actor, foreign school and changed payload retry without mutation", async () => {
  const db = await fixture();
  try {
    await assert.rejects(run(db, { user: userB, students: [student()] }), /Photographer ownership/);
    await assert.rejects(run(db, { school: schoolB, students: [student()] }), /School ownership/);
    await run(db, { students: [student()] });
    await assert.rejects(run(db, { fingerprint: "b".repeat(64), students: [student("2")] }), /different data/);
    assert.equal((await db.query("select count(*)::int n from students")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("SQL stale/duplicate source identity rolls back the entire batch and never alters existing photos", async () => {
  const db = await fixture();
  try {
    await run(db, { students: [student()] });
    await db.query("update students set photo_url='preserved-original',first_name='Edited' where external_student_id='gotphoto:00017'");
    await assert.rejects(run(db, { key: "second-import", students: [student("NEW"), student()] }), /Roster changed/);
    const existing = (await db.query("select * from students")).rows;
    assert.equal(existing.length, 1); assert.equal(existing[0].first_name, "Edited"); assert.equal(existing[0].photo_url, "preserved-original");
    assert.equal((await db.query("select count(*)::int n from gotphoto_import_requests")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("SQL malformed second row rolls back earlier creates and receipts", async () => {
  const db = await fixture();
  try {
    await assert.rejects(run(db, { students: [student(), { ...student("2"), externalId: "other:2" }] }), /Invalid student/);
    assert.equal((await db.query("select count(*)::int n from students")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from gotphoto_import_requests")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("SQL CRM import disables contact and does not invent opt-in consent, payments or history", async () => {
  const db = await fixture();
  try {
    const receipt = (await run(db, { contacts: [customer()] })).rows[0].receipt;
    assert.equal(receipt.importedContacts, 1);
    const contact = (await db.query("select * from crm_contacts")).rows[0];
    assert.equal(contact.marketing_consent, "unknown"); assert.equal(contact.do_not_contact, true);
    assert.equal(contact.preferred_channel, "none"); assert.equal(contact.consent_source, null);
    assert.equal(contact.photographer_id, ownerA);
    await assert.rejects(run(db, { key: "duplicate-customer", contacts: [customer("new@example.com"), customer()] }), /Contacts changed/);
    assert.equal((await db.query("select count(*)::int n from crm_clients")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from crm_contacts")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("SQL tenant scoping permits the other owner's separate identical email and source ID", async () => {
  const db = await fixture();
  try {
    await run(db, { students: [student()] });
    await run(db, { user: userB, owner: ownerB, school: schoolB, students: [student()] });
    await run(db, { key: "contact-import-a", contacts: [customer()] });
    await run(db, { user: userB, owner: ownerB, school: schoolB, key: "contact-import-b", contacts: [customer()] });
    assert.equal((await db.query("select count(*)::int n from students")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from crm_contacts")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("SQL readiness checks actual restricted privileges and RLS; browser roles cannot call import", async () => {
  const db = await fixture();
  try {
    assert.deepEqual((await db.query("select gotphoto_migration_schema_status() as status")).rows[0].status, {
      version: "20261008230000", import_rpc: true, ledger_rls: true, ledger_forced_rls: true, ledger_fields_complete: true, service_only: true,
    });
    await db.exec("set role authenticated");
    await assert.rejects(run(db, { students: [student()] }), /permission denied/);
    await assert.rejects(db.query("select * from gotphoto_import_requests"), /permission denied/);
    await db.exec("reset role");
    await db.exec("grant execute on function public.import_reviewed_gotphoto_csv(uuid,uuid,uuid,text,text,jsonb,jsonb) to authenticated");
    assert.equal((await db.query("select gotphoto_migration_schema_status() as status")).rows[0].status.service_only, false);
  } finally { await db.close(); }
});

test("SQL deleting an imported school preserves the normal delete lifecycle and clears its import receipts", async () => {
  const db = await fixture();
  try {
    await run(db, { students: [student()] });
    await run(db, { user: userB, owner: ownerB, school: schoolB, students: [student()] });
    // The real dashboard DELETE route removes its students before its school.
    await db.query("delete from students where school_id=$1", [schoolA]);
    await db.query("delete from schools where id=$1", [schoolA]);
    assert.deepEqual((await db.query("select school_id from gotphoto_import_requests")).rows, [{ school_id: schoolB }]);
    assert.deepEqual((await db.query("select school_id from students")).rows, [{ school_id: schoolB }]);
    assert.equal((await db.query("select count(*)::int n from schools")).rows[0].n, 1);
  } finally { await db.close(); }
});
