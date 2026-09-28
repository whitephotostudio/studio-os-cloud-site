import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { loadCrmClientIndexPage, loadCrmDashboard } = await import("../../lib/crm.ts");

function fakeService(tables) {
  const queries = [];
  const calls = [];
  return {
    queries,
    calls,
    from(table) {
      calls.push(table);
      const filters = [];
      const orders = [];
      let wantsCount = false;
      let rowLimit = Infinity;
      function materialize() {
        const rows = (tables[table] ?? [])
          .filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => {
            for (const [column, ascending] of orders) {
              const result = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
              if (result) return ascending ? result : -result;
            }
            return 0;
          });
        return { data: rows.slice(0, rowLimit), count: wantsCount ? rows.length : null, error: null };
      }
      const query = {
        select(_columns, options) {
          wantsCount = options?.count === "exact";
          return query;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        is(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        order(column, options = {}) {
          orders.push([column, options.ascending !== false]);
          return query;
        },
        limit(value) {
          rowLimit = value;
          return query;
        },
        async range(start, end) {
          queries.push({ table, start, end });
          const result = materialize();
          return { ...result, data: result.data.slice(start, end + 1) };
        },
        then(resolve, reject) {
          return Promise.resolve(materialize()).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("Clients index pages every owned client and includes later-page contact search data", async () => {
  const owner = "photographer-a";
  const clients = Array.from({ length: 205 }, (_, index) => ({
    id: `client-${String(index).padStart(3, "0")}`,
    photographer_id: owner,
    archived_at: null,
    display_name: `Client ${String(index).padStart(3, "0")}`,
    kind: "person",
  }));
  clients.push({
    id: "other-client",
    photographer_id: "photographer-b",
    archived_at: null,
    display_name: "Another owner's client",
    kind: "person",
  });
  const service = fakeService({
    crm_clients: clients,
    crm_contacts: [{
      id: "contact-204",
      client_id: "client-204",
      photographer_id: owner,
      archived_at: null,
      full_name: "Later Page Contact",
      email: "later@example.com",
      is_primary: true,
    }],
    crm_location_photos: [{
      id: "photo-204",
      client_id: "client-204",
      photographer_id: owner,
      category: "entrance",
      caption: "West entrance",
      alt_text: "Building door",
    }],
  });

  const first = await loadCrmClientIndexPage({ service, photographerId: owner, limit: 200 });
  const second = await loadCrmClientIndexPage({ service, photographerId: owner, limit: 200, offset: 200 });

  assert.deepEqual(first.page, { offset: 0, limit: 200, total: 205, hasMore: true });
  assert.deepEqual(second.page, { offset: 200, limit: 200, total: 205, hasMore: false });
  assert.equal(first.clients.length + second.clients.length, 205);
  assert.equal(second.clients.at(-1).displayName, "Client 204");
  assert.equal(second.contacts[0].email, "later@example.com");
  assert.equal(second.clients.at(-1).primaryContactId, "contact-204");
  assert.equal(second.locationPhotoSearch[0].caption, "West entrance");
  assert.ok(service.queries.some((query) => query.table === "crm_clients" && query.start === 200));
  assert.equal(first.clients.some((client) => client.id === "other-client"), false);
});

test("full CRM detail API exposes stable offset pages for new-computer downloads", async () => {
  const service = fakeService({
    crm_clients: [
      { id: "a", photographer_id: "owner", archived_at: null, display_name: "A" },
      { id: "b", photographer_id: "owner", archived_at: null, display_name: "B" },
      { id: "c", photographer_id: "owner", archived_at: null, display_name: "C" },
      { id: "other", photographer_id: "someone-else", archived_at: null, display_name: "Other" },
    ],
  });

  const result = await loadCrmDashboard({
    service,
    photographerId: "owner",
    offset: 2,
    limit: 2,
    includeTimeline: false,
  });

  assert.deepEqual(result.page, { offset: 2, limit: 2, total: 3, hasMore: false });
  assert.deepEqual(result.clients.map((client) => client.id), ["c"]);
  assert.equal(result.summary.totalClients, 1);
  assert.equal(service.calls.includes("crm_email_outbox"), false);
  assert.equal(service.calls.includes("crm_activities"), false);
});
