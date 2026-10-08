import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const user = "11111111-1111-4111-8111-111111111111", owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const school = "33333333-3333-4333-8333-333333333333", foreignSchool = "44444444-4444-4444-8444-444444444444";
let state;
const reset = () => { state = { user: { id: user }, mfaSatisfied: true, rpcCalls: [], serviceCalls: 0, tables: {
  photographers: [{ id: owner, user_id: user }], schools: [{ id: school, school_name: "One school", photographer_id: owner }, { id: foreignSchool, school_name: "Another owner", photographer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }], students: [], crm_contacts: [], gotphoto_import_requests: [],
} }; };

globalThis.__gotphotoRouteFixture = {
  auth: async () => ({ user: state.user, mfaSatisfied: state.mfaSatisfied }),
  service: () => {
    state.serviceCalls++;
    return {
      from(table) {
        let rows = [...(state.tables[table] ?? [])];
        const query = { select() { return query; }, eq(field, value) { rows = rows.filter((row) => row[field] === value); return query; }, order() { return query; },
          limit(size) { rows = rows.slice(0, size); return query; }, range(start, end) { return Promise.resolve({ data: rows.slice(start, end + 1), error: null }); },
          maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); }, then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); } };
        return query;
      },
      async rpc(name, args) { state.rpcCalls.push({ name, args }); return { data: { importedStudents: args.p_students.length, importedContacts: args.p_contacts.length, photosUploaded: 0 }, error: null }; },
    };
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const sources = {
      "next/server": 'export class NextRequest {} export class NextResponse { static json(body,init={}) { return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type":"application/json", ...init.headers } }); } }',
      "@/lib/dashboard-auth": 'export const resolveDashboardAuth=(request)=>globalThis.__gotphotoRouteFixture.auth(request); export const createDashboardServiceClient=()=>globalThis.__gotphotoRouteFixture.service();',
      "@/lib/require-agreement": 'export const guardAgreement=async()=>({ok:true});',
      "@/lib/rate-limit": 'export const rateLimit=async()=>({allowed:true});',
    };
    if (sources[specifier]) return { url: `data:text/javascript,${encodeURIComponent(sources[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { GET, POST } = await import("../../app/api/dashboard/migrations/gotphoto/route.ts");
const payload = { action: "preview", schoolId: school, kind: "roster", csv: "ID,First,Last,Class\n00017,Alice,Rivera,12A", mapping: { sourceId: "ID", firstName: "First", lastName: "Last", className: "Class" } };
const request = (body) => new Request("https://studio.test/api/dashboard/migrations/gotphoto", { method: "POST", body: JSON.stringify(body) });

test("route requires authentication and MFA before reading customer inventories", async () => {
  reset(); state.user = null;
  assert.equal((await POST(request(payload))).status, 401); assert.equal(state.serviceCalls, 0);
  reset(); state.mfaSatisfied = false;
  assert.equal((await POST(request(payload))).status, 403); assert.equal(state.serviceCalls, 0);
});

test("route returns only owned schools and refuses a foreign import destination", async () => {
  reset();
  const listed = await GET(new Request("https://studio.test/api/dashboard/migrations/gotphoto"));
  assert.deepEqual((await listed.json()).schools.map((row) => row.id), [school]);
  assert.equal((await POST(request({ ...payload, schoolId: foreignSchool }))).status, 404);
  assert.equal(state.rpcCalls.length, 0);
});

test("route preview is read-only; reviewed apply passes server-derived owner and complete new rows to the transaction", async () => {
  reset();
  const previewResponse = await POST(request(payload)), preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200); assert.equal(state.rpcCalls.length, 0);
  assert.equal(previewResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  const imported = await POST(request({ ...payload, action: "import", requestKey: "reviewed-request", previewFingerprint: preview.previewFingerprint }));
  assert.equal(imported.status, 200); assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].name, "import_reviewed_gotphoto_csv");
  assert.equal(state.rpcCalls[0].args.p_actor_user_id, user); assert.equal(state.rpcCalls[0].args.p_photographer_id, owner);
  assert.equal(state.rpcCalls[0].args.p_students[0].externalId, "gotphoto:00017");
  assert.deepEqual(state.rpcCalls[0].args.p_contacts, []);
});

test("route rejects modified source data, newly existing identities and invalid row previews before mutation", async () => {
  reset();
  const preview = await (await POST(request(payload))).json();
  const apply = { ...payload, action: "import", requestKey: "reviewed-request", previewFingerprint: preview.previewFingerprint };
  const changed = await POST(request({ ...apply, csv: payload.csv.replace("Alice", "Changed") }));
  assert.equal(changed.status, 409); assert.equal((await changed.json()).requiresPreview, true);
  state.tables.students.push({ id: "new-existing", school_id: school, external_student_id: "gotphoto:00017" });
  assert.equal((await POST(request(apply))).status, 409); assert.equal(state.rpcCalls.length, 0);
});

test("route replay reconciles the exact prior import without a second RPC and refuses key reuse with another CSV", async () => {
  reset();
  const preview = await (await POST(request(payload))).json();
  const apply = { ...payload, action: "import", requestKey: "reviewed-request", previewFingerprint: preview.previewFingerprint };
  await POST(request(apply));
  const args = state.rpcCalls[0].args;
  state.tables.gotphoto_import_requests.push({ photographer_id: owner, request_key: apply.requestKey, school_id: school, input_fingerprint: args.p_input_fingerprint, receipt: { importedStudents: 1 } });
  const replay = await POST(request(apply));
  assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true); assert.equal(state.rpcCalls.length, 1);
  assert.equal((await POST(request({ ...apply, csv: payload.csv.replace("Alice", "Changed") }))).status, 409);
});

test("route contact preview scopes existing emails to this owner and never derives consent", async () => {
  reset();
  state.tables.crm_contacts = [{ id: "existing", photographer_id: owner, email_normalized: "parent@example.com" }, { id: "foreign", photographer_id: "other", email_normalized: "new@example.com" }];
  const contacts = { ...payload, kind: "contacts", csv: "Name,Email\nExisting,Parent@Example.com\nNew Person,new@example.com", mapping: { fullName: "Name", email: "Email" } };
  const preview = await (await POST(request(contacts))).json();
  assert.equal(preview.preview.skipped.length, 1); assert.equal(preview.preview.contacts.length, 1);
  await POST(request({ ...contacts, action: "import", requestKey: "contacts-request", previewFingerprint: preview.previewFingerprint }));
  assert.deepEqual(state.rpcCalls[0].args.p_contacts, [{ fullName: "New Person", email: "new@example.com", phone: null }]);
});
