import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = (code) => ts.transpileModule(code, {
  fileName: "reorder.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
function findNode(predicate) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found);
  return found;
}
const effectNode = findNode((node) => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
  node.arguments[0]?.getText(ast).includes("studio-os-reorder-pending"));
const effect = effectNode.arguments[0].getText(ast);
const key = "schools/school/Class/Child/pose.jpg";
const preview = "/api/portal/school-preview/key.jpg?token=fresh";
const ordinaryEntry = { packageId: "pkg", quantity: 2, selectedImageUrl: key,
  slots: [{ label: "5x7", assignedImageUrl: key }],
  retouchSelections: [{ imageUrl: key, notes: "Preserve freckles" }],
  digitalSelections: [{ mediaId: key, url: key }], orientation: "portrait" };
const selectedBackdrop = { id: "available", name: "Blue", image_url: "/blue.jpg", tier: "premium", price_cents: 250 };

function run({ loading = false, backdrops = [], onlineBackdropsEnabled = true,
  snapshot = [ordinaryEntry], existingCart = [], store = null } = {}) {
  const writes = [], removed = [];
  let cart = [...existingCart], review = null, nextItem = 0;
  const savedSnapshot = JSON.stringify(snapshot);
  const storage = store ?? new Map([["studio-os-reorder-pending", "order"], ["studio-os-reorder:order", savedSnapshot]]);
  const scope = { loading, photographerId: "owner", packages: [{ id: "pkg", name: "Print", price_cents: 1200 }],
    backdrops, onlineBackdropsEnabled, isSchoolMode: true, currentLane: null,
    images: [{ id: key, storagePath: key, previewUrl: preview, url: preview }], reorderHydratedRef: { current: null },
    window: { sessionStorage: { getItem: (key) => storage.get(key) || null,
      removeItem: (key) => { removed.push(key); storage.delete(key); } } },
    crypto: { randomUUID: () => `new-item-${++nextItem}` }, DEFAULT_BACKDROP_BLUR_PX: 16,
    getCategory: () => "print", setCartItems: (change) => { cart = change(cart); },
    setReorderBackdropReview: (value) => { review = value; },
  };
  for (const name of ["BackdropPickerOpen", "DrawerOpen", "DrawerView", "ActiveSlotIndex"]) {
    scope[`set${name}`] = (value) => writes.push([name, value]);
  }
  vm.runInNewContext(compile(`(${effect})();`), scope);
  return { get cart() { return cart; }, get review() { return review; }, writes, removed, key, preview,
    storage, savedSnapshot, snapshot, scope };
}

function runReviewHandler(name, result, { photographerId = "owner", checkoutItems = result.cart } = {}) {
  const fn = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
  const values = { ...result.scope, photographerId, checkoutItems, reorderBackdropReview: result.review,
    openCartCheckout: () => result.writes.push(["OpenReviewedCheckout", true]) };
  vm.runInNewContext(compile(`(${fn})();`), values);
}

test("a loaded empty school backdrop catalog restores ordinary print/retouch choices using authorized previews", () => {
  const result = run();
  assert.equal(result.cart.length, 1);
  const entry = result.cart[0];
  assert.equal(entry.quantity, 2);
  assert.equal(entry.packageSubtotalCents, 2400);
  assert.equal(entry.selectedImageUrl, result.preview);
  assert.equal(entry.slots[0].assignedImageUrl, result.preview);
  assert.equal(entry.retouchSelections[0].imageUrl, result.preview);
  assert.equal(entry.retouchSelections[0].notes, "Preserve freckles");
  assert.equal(entry.digitalSelections[0].url, result.preview);
  assert.equal(entry.backdrop, null);
  assert.equal(result.review, null);
  assert.equal(result.removed.length, 2);
  assert.deepEqual(Array.from(result.writes[1]), ["DrawerOpen", true]);
});

test("reorder waits for the current gallery load rather than consuming a stale preview/catalog snapshot", () => {
  const result = run({ loading: true });
  assert.equal(result.cart.length, 0);
  assert.equal(result.review, null);
  assert.equal(result.removed.length, 0);
});

test("disabled and hidden paid reorder backgrounds require explicit review before entering the basket", () => {
  const snapshot = [{ ...ordinaryEntry, backdrop: { id: "available", blurred: true, blurAmount: 20 }, orientation: "landscape" }];
  const originalPaidSnapshot = JSON.stringify(snapshot);
  for (const config of [{ onlineBackdropsEnabled: false, backdrops: [selectedBackdrop] }, { onlineBackdropsEnabled: true, backdrops: [] }]) {
    const existing = { id: "existing-basket-item" };
    const result = run({ ...config, snapshot, existingCart: [existing] });
    assert.deepEqual(result.cart, [existing], "changed new items never silently enter the basket");
    assert.equal(result.review.photographerId, "owner");
    assert.equal(result.review.originalBackgroundCount, 1);
    const staged = result.review.items[0];
    assert.equal(staged.backdrop, null);
    assert.equal(staged.backdropAddOnCents, 0);
    assert.equal(staged.lineTotalCents, 2400);
    assert.equal(staged.orientation, "portrait");
    assert.equal(staged.selectedImageUrl, preview);
    assert.equal(JSON.stringify(snapshot), originalPaidSnapshot, "paid snapshot and delivery references stay untouched");
    assert.ok(result.writes.some(([name, value]) => name === "DrawerOpen" && value === true));
  }
});

test("an available paid reorder background remains selected with its current price", () => {
  const result = run({ backdrops: [selectedBackdrop], snapshot: [{ ...ordinaryEntry,
    backdrop: { id: "available", blurred: true, blurAmount: 20 }, orientation: "landscape" }] });
  assert.equal(result.review, null);
  assert.equal(result.cart[0].backdrop.id, "available");
  assert.equal(result.cart[0].backdrop.blurred, true);
  assert.equal(result.cart[0].backdrop.blurAmount, 20);
  assert.equal(result.cart[0].backdropAddOnCents, 250);
  assert.equal(result.cart[0].lineTotalCents, 2650);
  assert.equal(result.cart[0].orientation, "landscape");
});

function mixedReview() {
  const existing = { id: "existing-basket-item", backdrop: { id: "another-school-backdrop" }, laneKey: "another-school:student" };
  const snapshot = [{ ...ordinaryEntry, backdrop: { id: "available" }, orientation: "landscape" },
    { ...ordinaryEntry, backdrop: { id: "hidden" }, orientation: "landscape" }];
  return run({ backdrops: [selectedBackdrop], snapshot, existingCart: [existing] });
}

test("mixed reorder holds every new row, accepts originals only for unavailable backgrounds and cannot duplicate on repeat acceptance", () => {
  const result = mixedReview();
  const existingBasket = JSON.stringify(result.cart);
  const oldSnapshot = JSON.stringify(result.snapshot);
  assert.equal(result.cart.length, 1, "the available row is held too, so no partial reorder persists");
  assert.equal(result.review.items.length, 2);
  assert.equal(result.review.originalBackgroundCount, 1);
  const review = result.review;
  runReviewHandler("acceptOriginalBackgroundReorder", result);
  assert.equal(result.review, null);
  assert.equal(result.cart.length, 3);
  assert.equal(JSON.stringify(result.cart.slice(0, 1)), existingBasket);
  assert.equal(result.cart[1].backdrop.id, "available");
  assert.equal(result.cart[1].orientation, "landscape");
  assert.equal(result.cart[2].backdrop, null);
  assert.equal(result.cart[2].orientation, "portrait");
  assert.equal(result.cart[2].backdropAddOnCents, 0);
  // A rapid second click can still invoke the prior rendered handler. Its
  // functional cart update must deduplicate those exact reviewed item IDs.
  result.scope.setReorderBackdropReview(review);
  runReviewHandler("acceptOriginalBackgroundReorder", result);
  assert.equal(result.cart.length, 3);
  assert.equal(JSON.stringify(result.snapshot), oldSnapshot);
  assert.ok(result.writes.some(([name]) => name === "OpenReviewedCheckout"));
});

test("skipping or reloading a mixed unconfirmed reorder preserves the pre-existing basket and adds no partial or duplicate rows", () => {
  for (const action of ["skip", "reload"]) {
    const result = mixedReview();
    const existingBasket = JSON.stringify(result.cart);
    assert.equal(result.storage.has("studio-os-reorder-pending"), false);
    assert.equal(result.storage.has("studio-os-reorder:order"), false);
    if (action === "skip") {
      runReviewHandler("skipOriginalBackgroundReorder", result);
      assert.equal(result.review, null);
      assert.equal(JSON.stringify(result.cart), existingBasket);
    } else {
      // Simulate the component remount reading the same sessionStorage while
      // combine-cart hydration restores only the unchanged existing basket.
      const reloaded = run({ store: result.storage, existingCart: result.cart, backdrops: [selectedBackdrop] });
      assert.equal(reloaded.review, null);
      assert.equal(JSON.stringify(reloaded.cart), existingBasket);
      assert.equal(reloaded.removed.length, 0);
    }
  }
});

test("accepting a reorder review from another studio cannot alter the current basket", () => {
  const result = mixedReview();
  const before = JSON.stringify(result.cart);
  runReviewHandler("acceptOriginalBackgroundReorder", result, { photographerId: "different-studio" });
  assert.equal(JSON.stringify(result.cart), before);
  assert.equal(result.review.photographerId, "owner");
  assert.equal(result.writes.some(([name]) => name === "OpenReviewedCheckout"), false);
});

test("the actual review notice lists the accepted output and explains the safe reload reset", () => {
  const notice = findNode((node) => ts.isJsxExpression(node) &&
    node.expression?.getText(ast).startsWith("reorderBackdropReview?.photographerId === photographerId"));
  const result = mixedReview();
  const scope = { React, result: null, reorderBackdropReview: result.review, photographerId: "owner",
    acceptOriginalBackgroundReorder: () => {}, skipOriginalBackgroundReorder: () => {} };
  vm.runInNewContext(compile(`result = (${notice.expression.getText(ast)});`), scope);
  const html = renderToStaticMarkup(scope.result);
  assert.match(html, /Review reordered backgrounds/);
  assert.match(html, /Unavailable backgrounds will use the original photo backgrounds/);
  assert.match(html, /available selected backgrounds will stay selected/);
  assert.match(html, /None of these reordered items have been added to your basket/);
  assert.match(html, /Refreshing this page discards this unconfirmed reorder/);
  assert.match(html, /Print × 2 — Blue/);
  assert.match(html, /Print × 2 — Original photo background/);
  assert.match(html, /Add reviewed reorder/);
  assert.match(html, /Skip this reorder/);
  scope.photographerId = "other-studio";
  vm.runInNewContext(compile(`result = (${notice.expression.getText(ast)});`), scope);
  assert.equal(renderToStaticMarkup(scope.result), "", "another studio cannot display this scoped review");
});

test("an explicit reorder resets the prior review and hydration marker before opening Photos, so a repeated review can be rebuilt", () => {
  const handler = findNode((node) => ts.isJsxAttribute(node) && node.name.getText(ast) === "onReorder").initializer.expression;
  const stored = new Map(), ref = { current: "order" }, calls = [];
  const scope = { snapshot: [ordinaryEntry], sourceOrderId: "order", reorderHydratedRef: ref,
    setReorderBackdropReview: (value) => calls.push(["review", value]),
    setActiveView: (value) => calls.push(["view", value]), crypto: { randomUUID: () => "new-purchase" },
    sessionStorage: { setItem: (key, value) => stored.set(key, value) } };
  vm.runInNewContext(compile(`(${handler.getText(ast)})(snapshot, sourceOrderId);`), scope);
  assert.equal(ref.current, null);
  assert.deepEqual(calls, [["review", null], ["view", "photos"]]);
  assert.equal(stored.get("studio-os-reorder-pending"), "order");
  assert.equal(stored.get("studio-os-reorder:order"), JSON.stringify([ordinaryEntry]));
  const effectDependencies = effectNode.arguments[1];
  assert.ok(effectDependencies.elements.some((dependency) => dependency.getText(ast) === "activeView"),
    "Orders-to-Photos navigation reruns hydration even when packages and catalog are already loaded");
});
