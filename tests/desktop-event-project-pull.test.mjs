import assert from "node:assert/strict";
import test from "node:test";
import { loadDesktopEventProjects } from "../lib/desktop-event-project-pull.ts";

function fakeService(tables) {
  const reads = [];
  return {
    reads,
    from(table) {
      const filters = [];
      const orders = [];
      const query = {
        select() { return query; },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        is(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        or(expression) {
          assert.equal(expression, "status.is.null,status.neq.deleted");
          filters.push((row) => row.status == null || row.status !== "deleted");
          return query;
        },
        order(column, options = {}) {
          orders.push([column, options.ascending !== false]);
          return query;
        },
        async range(start, end) {
          reads.push({ table, start, end });
          const rows = (tables[table] ?? [])
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => {
              for (const [column, ascending] of orders) {
                const result = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
                if (result) return ascending ? result : -result;
              }
              return 0;
            });
          return { data: rows.slice(start, end + 1), error: null };
        },
      };
      return query;
    },
  };
}

test("desktop pull restores projects and albums beyond database page limits", async () => {
  const photographerId = "owner-a";
  const projects = Array.from({ length: 1005 }, (_, index) => ({
    id: `p${String(index).padStart(4, "0")}`,
    photographer_id: photographerId,
    workflow_type: "event",
    status: "active",
    title: `Project ${index}`,
    created_at: "2026-09-28T00:00:00Z",
  }));
  projects.push(
    { ...projects[0], id: "other-owner", photographer_id: "owner-b" },
    { ...projects[0], id: "school-project", workflow_type: "school" },
    { ...projects[0], id: "deleted-project", status: "deleted" },
  );
  const collections = Array.from({ length: 1200 }, (_, index) => ({
    id: `album-${String(index).padStart(4, "0")}`,
    project_id: "p0000",
    deleted_at: null,
    sort_order: index,
  }));
  collections.push(
    { id: "last-album", project_id: "p1004", deleted_at: null, sort_order: 0 },
    { id: "deleted-album", project_id: "p1004", deleted_at: "2026-09-28", sort_order: 1 },
  );
  const service = fakeService({ projects, collections });

  const pulled = await loadDesktopEventProjects({ service, photographerId });

  assert.equal(pulled.length, 1005);
  assert.equal(pulled.find((row) => row.project.id === "p0000").collections.length, 1200);
  assert.deepEqual(pulled.find((row) => row.project.id === "p1004").collections.map((row) => row.id), ["last-album"]);
  assert.equal(pulled.some((row) => row.project.id === "other-owner"), false);
  assert.equal(pulled.some((row) => row.project.id === "school-project"), false);
  assert.equal(pulled.some((row) => row.project.id === "deleted-project"), false);
  assert.ok(service.reads.some((read) => read.table === "projects" && read.start === 1000));
  assert.ok(service.reads.some((read) => read.table === "collections" && read.start === 1000));
  assert.ok(service.reads.length < 30, "batch albums instead of one query per project");
});
