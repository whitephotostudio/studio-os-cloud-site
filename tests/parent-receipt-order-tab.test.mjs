import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const page = ts.createSourceFile("parent-gallery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const matches = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect"
      && node.arguments[0]?.getText(page).includes("orderTabHintConsumedRef.current")) {
    matches.push(node);
  }
  ts.forEachChild(node, visit);
}
visit(page);
assert.equal(matches.length, 1, "Execute the existing receipt entry effect rather than a copied guard");
const effect = matches[0];
const executable = ts.transpileModule(`return { effect: ${effect.arguments[0].getText(page)}, dependencies: ${effect.arguments[1].getText(page)} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const prepareEffect = new Function("loading", "error", "student", "initialTabHint", "galleryTabs",
  "orderTabHintConsumedRef", "setActiveView", executable);

function galleryHarness(overrides = {}) {
  const consumed = { current: false };
  const selections = [];
  const state = { loading: true, error: "", student: null, initialTabHint: "orders",
    galleryTabs: ["photos", "orders"], ...overrides };
  let priorDependencies;
  let activeView = "photos";
  function render(changes = {}) {
    Object.assign(state, changes);
    const prepared = prepareEffect(state.loading, state.error, state.student, state.initialTabHint,
      state.galleryTabs, consumed, (view) => { activeView = view; selections.push(view); });
    if (!priorDependencies || prepared.dependencies.some((value, index) => !Object.is(value, priorDependencies[index]))) {
      prepared.effect();
    }
    priorDependencies = prepared.dependencies;
  }
  return { render, consumed, selections, get activeView() { return activeView; },
    select(view) { activeView = view; } };
}

test("receipt Orders hint survives gallery loading and opens only after the loader's Photos reset", () => {
  const student = { id: "synthetic-student" };
  const harness = galleryHarness();
  harness.render();
  assert.equal(harness.consumed.current, false);
  assert.equal(harness.activeView, "photos");
  harness.render({ student });
  assert.equal(harness.consumed.current, false, "An early student update does not consume a loading gallery's hint");
  harness.select("photos"); // The actual gallery loader finishes by choosing Photos.
  harness.render({ loading: false });
  assert.equal(harness.activeView, "orders", "The loading dependency schedules receipt entry after the final Photos reset");
  assert.deepEqual(harness.selections, ["orders"]);
  assert.equal(harness.consumed.current, true);
  harness.select("photos"); // Parents remain free to choose another tab afterward.
  harness.render({ galleryTabs: ["photos", "orders"] });
  harness.render({ student: { ...student } });
  assert.equal(harness.activeView, "photos");
  assert.deepEqual(harness.selections, ["orders"], "The hint runs once, even when gallery state refreshes");
});

test("hidden Orders tab retains its hint until the authorized gallery enables that tab", () => {
  const harness = galleryHarness({ loading: false, student: { id: "synthetic-student" }, galleryTabs: ["photos"] });
  harness.render();
  assert.equal(harness.consumed.current, false);
  assert.deepEqual(harness.selections, []);
  harness.render({ galleryTabs: ["photos", "orders"] });
  assert.equal(harness.activeView, "orders");
  assert.equal(harness.consumed.current, true);
});

test("failed or absent gallery identity cannot consume receipt entry before a successful retry", () => {
  const student = { id: "synthetic-student" };
  const failed = galleryHarness({ loading: false, error: "Gallery access failed", student });
  failed.render();
  assert.equal(failed.consumed.current, false);
  assert.deepEqual(failed.selections, []);
  failed.render({ error: "" });
  assert.equal(failed.activeView, "orders", "A cleared error reruns the actual effect");
  const absent = galleryHarness({ loading: false });
  absent.render();
  assert.equal(absent.consumed.current, false);
  assert.deepEqual(absent.selections, []);
  absent.render({ student });
  assert.equal(absent.activeView, "orders", "A loaded identity reruns the actual effect");
});

test("ordinary gallery entry and other tab hints stay on Photos without consuming the Orders hint", () => {
  for (const initialTabHint of ["", "photos", "favorites", "Orders"]) {
    const harness = galleryHarness({ loading: false, student: { id: "synthetic-student" }, initialTabHint });
    harness.render();
    assert.equal(harness.consumed.current, false);
    assert.equal(harness.activeView, "photos");
    assert.deepEqual(harness.selections, []);
  }
});
