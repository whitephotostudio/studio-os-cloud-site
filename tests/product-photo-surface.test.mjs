import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../components/parents/product-photo-surface.tsx", import.meta.url), "utf8");
const gallery = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx };
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const backdrop = {
  url: "https://storage.example/thumb.jpg",
  fallbackUrl: "https://storage.example/backdrop.jpg",
  foregroundUrl: "https://storage.example/pose-one.png?signature=one",
  landscape: false, foregroundScale: 1.08, foregroundVerticalOffset: 0.06, blurPx: 0,
};
const props = { imageUrl: "/original-one.jpg", backdrop };

function findAll(node, type) {
  if (!node || typeof node !== "object") return [];
  const children = [node.props?.children].flat(Infinity);
  return [ ...(node.type === type ? [node] : []), ...children.flatMap((child) => findAll(child, type)) ];
}

function harness(initial = props) {
  let values = [], cursor = 0, key;
  const exports = {};
  const useState = (initialValue) => {
    const store = values;
    const index = cursor++;
    if (!(index in store)) store[index] = initialValue;
    return [store[index], (value) => { store[index] = typeof value === "function" ? value(store[index]) : value; }];
  };
  vm.runInNewContext(compile(source), {
    exports,
    require: (name) => name === "react" ? { useState, useId: () => "test-blur" } : name === "react/jsx-runtime" ? runtime : require(name),
  });
  let current = initial;
  return {
    render(next = current) {
      current = next;
      const root = exports.ProductPhotoSurface(current);
      if (root.key !== key) { values = []; key = root.key; }
      cursor = 0;
      return root.type(root.props);
    },
  };
}

test("signed-storage portrait stays visible until both backdrop layers load without canvas export", () => {
  const ui = harness();
  let tree = ui.render();
  assert.equal(findAll(tree, "svg")[0].props.style.opacity, 0);
  assert.equal(findAll(tree, "img")[0].props.style.visibility, "visible");
  findAll(tree, "image")[0].props.onLoad();
  tree = ui.render();
  assert.equal(findAll(tree, "svg")[0].props.style.opacity, 0, "backdrop alone must never be shown");
  const foreground = findAll(tree, "image")[1];
  assert.equal(foreground.props.href, backdrop.foregroundUrl);
  assert.equal(foreground.props.crossOrigin, undefined);
  foreground.props.onLoad();
  tree = ui.render();
  assert.equal(findAll(tree, "svg")[0].props.style.opacity, 1);
  assert.equal(findAll(tree, "img")[0].props.style.visibility, "hidden");
  assert.equal(findAll(tree, "canvas").length, 0);
});

test("cutout failure shows the original portrait instead of an empty backdrop", () => {
  const ui = harness();
  let tree = ui.render();
  findAll(tree, "image")[0].props.onLoad();
  findAll(tree, "image")[1].props.onError();
  tree = ui.render();
  assert.equal(findAll(tree, "svg").length, 0);
  assert.equal(findAll(tree, "img")[0].props.src, props.imageUrl);
  assert.equal(findAll(tree, "img")[0].props.style.visibility, "visible");
});

test("backdrop thumbnail failure retries the full backdrop and safely handles total failure", () => {
  const ui = harness();
  let tree = ui.render();
  findAll(tree, "image")[0].props.onError();
  tree = ui.render();
  assert.equal(findAll(tree, "image")[0].props.href, backdrop.fallbackUrl);
  assert.equal(findAll(tree, "svg")[0].props.style.opacity, 0);
  findAll(tree, "image")[0].props.onError();
  tree = ui.render();
  assert.equal(findAll(tree, "svg").length, 0);
  assert.equal(findAll(tree, "img")[0].props.style.visibility, "visible");
});

test("changing poses drops stale loading events and removing the backdrop restores the current original", () => {
  const ui = harness();
  const oldImages = findAll(ui.render(), "image");
  const next = { imageUrl: "/original-two.jpg", backdrop: { ...backdrop, foregroundUrl: "/pose-two.png" } };
  let tree = ui.render(next);
  oldImages.forEach((image) => image.props.onLoad());
  tree = ui.render();
  assert.equal(findAll(tree, "svg")[0].props.style.opacity, 0);
  assert.equal(findAll(tree, "image")[1].props.href, "/pose-two.png");
  findAll(tree, "image").forEach((image) => image.props.onLoad());
  assert.equal(findAll(ui.render(), "svg")[0].props.style.opacity, 1);
  tree = ui.render({ ...next, backdrop: null });
  assert.equal(findAll(tree, "svg").length, 0);
  assert.equal(findAll(tree, "img")[0].props.src, next.imageUrl);
});

test("landscape framing and backdrop-only blur are preserved", () => {
  const ui = harness({ ...props, style: { objectFit: "cover" }, backdrop: { ...backdrop, landscape: true, blurPx: 12 } });
  const tree = ui.render();
  const svg = findAll(tree, "svg")[0];
  assert.equal(svg.props.viewBox, "0 0 1067 800");
  assert.equal(svg.props.preserveAspectRatio, "xMidYMid slice");
  const [background, foreground] = findAll(tree, "image");
  assert.equal(background.props.filter, "url(#test-blur)");
  assert.equal(findAll(tree, "feGaussianBlur")[0].props.stdDeviation, 12);
  assert.equal(foreground.props.preserveAspectRatio, "xMidYMid meet");
  assert.equal(foreground.props.width, 1067 * 1.08);
  assert.equal(foreground.props.y, (800 - 800 * 1.08) / 2 + 800 * 0.06);
  assert.equal(foreground.props.filter, undefined);
});

test("every product mockup carries both photo and backdrop through all preview variants", () => {
  const start = gallery.indexOf("function renderPhotoSurface(");
  const end = gallery.indexOf("// Wall / Desk / Close-up scene switcher removed", start);
  const exports = {};
  vm.runInNewContext(compile(gallery.slice(start, end) + "\nexport { renderPremiumMockup };"), {
    exports, ProductPhotoSurface: "ProductPhotoSurface", require: () => runtime,
  });
  for (const kind of ["package", "digital", "specialty", "print", "canvas", "metal"]) {
    for (const variant of [0, 1, 2]) {
      const tree = exports.renderPremiumMockup(kind, props.imageUrl, variant, false, "5x7", undefined, 0.75, false, "portrait", backdrop);
      const surfaces = findAll(tree, "ProductPhotoSurface");
      assert.ok(surfaces.length > 0, `${kind}/${variant} has a photo surface`);
      for (const surface of surfaces) {
        assert.equal(surface.props.imageUrl, props.imageUrl);
        assert.equal(surface.props.backdrop, backdrop, `${kind}/${variant} includes the student cutout`);
      }
    }
  }
  const ast = ts.createSourceFile("page.tsx", gallery, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let calls = 0;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "renderPremiumMockup") {
      calls++;
      assert.equal(node.arguments.at(-1).getText(ast), "productBackdrop");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(calls, 3, "category tiles, package list and product details are all wired");
});
