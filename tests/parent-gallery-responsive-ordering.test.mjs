import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("parents-page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), variables = new Map(), styles = [], buttons = [];
function property(object, name) {
  return object.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(ast).replaceAll('"', "") === name)?.initializer;
}
function attributes(element) {
  return element.attributes.properties.filter(ts.isJsxAttribute);
}
function attribute(element, name) {
  return attributes(element).find(item => item.name.text === name)?.initializer;
}
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const style = attribute(node, "style");
    if (style && ts.isJsxExpression(style) && style.expression && ts.isObjectLiteralExpression(style.expression)) {
      styles.push({ element: node, object: style.expression });
      if (node.tagName.getText(ast) === "button") buttons.push({ element: node, object: style.expression });
    }
  }
  ts.forEachChild(node, collect);
}
collect(ast);
function evaluate(text, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(`exports.value = (${text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, ...globals });
  return exports.value;
}
function loadFunction(name, globals = {}) {
  assert.ok(functions.has(name), `Expected production function ${name}`);
  return evaluate(functions.get(name), globals);
}
function styleWhere(predicate) {
  const matched = styles.filter(({ object, element }) => predicate(object, element));
  assert.equal(matched.length, 1, "Expected exactly one production style binding");
  return matched[0].object;
}
const styleGlobals = overrides => ({
  isMobileViewport: false,
  isCompactPanelViewport: false,
  isEventImageStage: true,
  isEventLanding: false,
  isLightGallery: false,
  galleryTone: { background: "#080808", border: "#333" },
  drawerOpen: false,
  backdropPickerOpen: false,
  ...overrides,
});

test("tablet panel breakpoint is independent from the saved phone photo density", () => {
  assert.equal(variables.get("isCompactPanelViewport")?.getText(ast), "useIsMobile(1100)");
  assert.equal(variables.get("isMobileViewport")?.getText(ast), "useIsMobile()");
  for (const width of [320, 390, 639, 640, 768, 1024, 1099, 1100, 1440]) {
    let state = false, cleanup, subscription;
    const queries = [];
    const useIsMobile = loadFunction("useIsMobile", {
      useState: () => [state, value => { state = value; }],
      useEffect: callback => { cleanup = callback(); },
      window: { matchMedia(query) {
        queries.push(query);
        return {
          matches: width <= Number(query.match(/max-width: (\d+)px/)[1]),
          addEventListener(event, callback) { assert.equal(event, "change"); subscription = callback; },
          removeEventListener(event, callback) { assert.equal(event, "change"); assert.equal(callback, subscription); subscription = null; },
        };
      } },
    });
    useIsMobile(1100);
    assert.deepEqual(queries, ["(max-width: 1099px)"]);
    assert.equal(state, width < 1100, `${width}px panel layout`);
    assert.equal(typeof subscription, "function");
    cleanup();
    assert.equal(subscription, null, "The media listener must be removed on unmount");
  }
});

test("rotating or resizing a tablet updates the production breakpoint hook", () => {
  let state = false, subscription, cleanup;
  const media = {
    matches: true,
    addEventListener(_event, callback) { subscription = callback; },
    removeEventListener(_event, callback) { assert.equal(callback, subscription); subscription = null; },
  };
  loadFunction("useIsMobile", {
    useState: () => [state, value => { state = value; }],
    useEffect: callback => { cleanup = callback(); },
    window: { matchMedia: () => media },
  })(1100);
  assert.equal(state, true);
  media.matches = false;
  subscription();
  assert.equal(state, false);
  media.matches = true;
  subscription();
  assert.equal(state, true);
  cleanup();
});

test("phone and tablet order/backdrop panels occupy the full canvas instead of shrinking the photo", () => {
  const panel = size => styleWhere(object => {
    const width = property(object, "width");
    return width && ts.isConditionalExpression(width) && width.whenFalse.getText(ast) === String(size)
      && property(object, "flexShrink")?.getText(ast) === "0";
  });
  const photoArea = styleWhere(object => property(object, "display")?.getText(ast).includes("drawerOpen || backdropPickerOpen"));
  for (const width of [320, 390, 768, 1024, 1099, 1100, 1440]) {
    const compact = width < 1100;
    const globals = styleGlobals({ isCompactPanelViewport: compact, isMobileViewport: width < 640 });
    for (const size of [620, 520]) {
      const style = evaluate(panel(size).getText(ast), globals);
      assert.equal(style.width, compact ? "100%" : size, `${width}px / ${size}px panel`);
      assert.equal(style.maxWidth, "100vw");
      assert.equal(style.borderLeft === "none", compact);
      assert.equal(style.flexShrink, 0);
      assert.equal(style.overflow, "hidden");
    }
    for (const [drawerOpen, backdropPickerOpen] of [[false, false], [true, false], [false, true]]) {
      const style = evaluate(photoArea.getText(ast), { ...globals, drawerOpen, backdropPickerOpen });
      assert.equal(style.display, compact && (drawerOpen || backdropPickerOpen) ? "none" : "flex");
    }
  }
});

test("tablet headers stack the picker and actions without desktop absolute navigation", () => {
  const topbar = styleWhere(object => property(object, "minHeight")?.getText(ast) === "isEventImageStage ? 72 : 52");
  const nav = styleWhere(object => property(object, "position")?.getText(ast).includes('"static" : "absolute"') && property(object, "order"));
  for (const compact of [true, false]) {
    const globals = styleGlobals({ isCompactPanelViewport: compact });
    const headerStyle = evaluate(topbar.getText(ast), globals);
    assert.equal(headerStyle.display, compact ? "grid" : "flex");
    assert.equal(headerStyle.gridTemplateColumns, compact ? "minmax(0, 1fr)" : undefined);
    const navStyle = evaluate(nav.getText(ast), globals);
    assert.equal(navStyle.position, compact ? "static" : "absolute");
    assert.equal(navStyle.width, compact ? "100%" : undefined);
    assert.equal(navStyle.transform, compact ? undefined : "translateX(-50%)");
    assert.equal(evaluate(topbar.getText(ast), { ...globals, isEventLanding: true }).display, "none");
  }
});

function opening(name, overrides = {}) {
  const changes = [];
  const state = { activeView: overrides.activeView ?? "favorites", eventPhotoStage: overrides.eventPhotoStage ?? "albums", drawerOpen: false, backdropPickerOpen: true, drawerView: "build-package", activeSlotIndex: 2 };
  const setters = Object.fromEntries(Object.keys(state).map(key => [`set${key[0].toUpperCase()}${key.slice(1)}`, value => { state[key] = value; changes.push([key, value]); }]));
  loadFunction(name, { ...setters, orderingDisabled: false, isSchoolMode: false, eventPhotoStage: state.eventPhotoStage, ...overrides })();
  return { state, changes };
}

test("store and basket opening makes the drawer visible from favorites and album overview", () => {
  const canvas = styleWhere(object => property(object, "display")?.getText(ast).includes('activeView === "photos" && !showAlbumOverview'));
  for (const name of ["openBuyDrawer", "openCartCheckout"]) for (const activeView of ["favorites", "about", "orders", "store", "photos"]) {
    const { state } = opening(name, { activeView });
    assert.equal(state.activeView, "photos");
    assert.equal(state.eventPhotoStage, "grid");
    assert.equal(state.drawerOpen, true);
    assert.equal(state.backdropPickerOpen, false);
    assert.equal(state.activeSlotIndex, null);
    assert.equal(state.drawerView, name === "openCartCheckout" ? "checkout" : "product-select");
    const canvasStyle = evaluate(canvas.getText(ast), { activeView: state.activeView, showAlbumOverview: state.eventPhotoStage === "albums" });
    assert.equal(canvasStyle.display, "flex", `The actual containing canvas must be visible after ${name} from ${activeView}`);
  }
});

test("opening panels retains the current event photo and does not force school galleries into an event grid", () => {
  for (const name of ["openBuyDrawer", "openCartCheckout"]) {
    for (const isSchoolMode of [true, false]) for (const eventPhotoStage of ["albums", "grid", "viewer"]) {
      const { changes } = opening(name, { isSchoolMode, eventPhotoStage });
      const stageChanges = changes.filter(([key]) => key === "eventPhotoStage");
      assert.deepEqual(stageChanges, !isSchoolMode && eventPhotoStage === "albums" ? [["eventPhotoStage", "grid"]] : []);
    }
  }
  const blocked = opening("openBuyDrawer", { orderingDisabled: true });
  assert.deepEqual(blocked.changes, [], "Closed ordering must not open a product panel");
});

test("both ordering panels have named touch-sized close controls", () => {
  for (const label of ["Close order panel", "Close backdrop picker"]) {
    const matches = buttons.filter(({ element }) => attribute(element, "aria-label")?.getText(ast) === JSON.stringify(label));
    assert.equal(matches.length, 1, label);
    const { element, object } = matches[0], style = evaluate(object.getText(ast));
    assert.ok(style.minWidth >= 44 && style.minHeight >= 44, `${label} touch area`);
    const handler = attribute(element, "onClick");
    assert.ok(handler && ts.isJsxExpression(handler) && handler.expression);
    let close;
    evaluate(handler.expression.getText(ast), {
      setDrawerOpen: value => { close = value; },
      setBackdropPickerOpen: value => { close = value; },
    })();
    assert.equal(close, false);
  }
});

test("checkout inputs and shipping columns can shrink inside a narrow phone panel", () => {
  const inputStyle = evaluate(variables.get("darkInput").getText(ast));
  assert.equal(inputStyle.minWidth, 0);
  assert.equal(inputStyle.width, "100%");
  assert.equal(inputStyle.boxSizing, "border-box");
  const cityInput = [];
  function findCity(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input" && attribute(node, "placeholder")?.getText(ast) === '"City"') cityInput.push(node);
    ts.forEachChild(node, findCity);
  }
  findCity(ast);
  assert.equal(cityInput.length, 1);
  const gridAttribute = attribute(cityInput[0].parent.openingElement, "style");
  const gridStyle = evaluate(gridAttribute.expression.getText(ast));
  assert.equal(gridStyle.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
});
