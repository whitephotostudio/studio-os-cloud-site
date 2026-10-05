import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };

function execute(source, globals = {}) {
  const context = { exports: {}, require: name => {
    assert.equal(name, "react/jsx-runtime");
    return runtime;
  }, ...globals };
  vm.runInNewContext(compile(source), context);
  return context;
}
const settings = execute(read("lib/event-gallery-settings.ts")).exports;

function ast(path) {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findOne(tree, predicate, description) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1, `Expected one ${description}, found ${matches.length}`);
  return matches[0].getText(tree);
}
function variable(tree, name) {
  return findOne(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name, name)
    .replace(new RegExp(`^${name}\\s*=\\s*`), "");
}
function declaration(tree, name) {
  return findOne(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name, name);
}
function render(expression, globals = {}, prefix = "") {
  return execute(`${prefix}\nexports.result = (${expression});`, globals).exports.result;
}
function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return [node.props?.children].flat(Infinity).map(textOf).join("");
}
function nodes(node, type) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, type))];
}

test("new and legacy galleries without a saved count preference hide photo counts", () => {
  assert.equal(settings.defaultEventGalleryExtras.hideAlbumPhotoCount, true);
  for (const stored of [undefined, null, {}, { extras: {} }, { extras: { hideAlbumPhotoCount: "false" } }]) {
    assert.equal(settings.normalizeEventGallerySettings(stored).extras.hideAlbumPhotoCount, true);
  }
});

test("explicit saved show and hide choices survive normalization and save round trips", () => {
  for (const hideAlbumPhotoCount of [false, true]) {
    const stored = { extras: { hideAlbumPhotoCount, allowSocialSharing: true } };
    const normalized = settings.normalizeEventGallerySettings(stored);
    assert.equal(normalized.extras.hideAlbumPhotoCount, hideAlbumPhotoCount);
    const saved = JSON.parse(JSON.stringify(normalized));
    const reloaded = settings.normalizeEventGallerySettings(saved);
    assert.equal(reloaded.extras.hideAlbumPhotoCount, hideAlbumPhotoCount);
    assert.equal(reloaded.extras.allowSocialSharing, true);
  }
});

for (const [kind, path] of [
  ["event", "app/dashboard/projects/[id]/settings/page.tsx"],
  ["school", "app/dashboard/projects/schools/[schoolId]/settings/page.tsx"],
]) {
  test(`${kind} owner Show photo counts toggle turns the saved hide flag off and on`, () => {
    const tree = ast(path);
    const toggle = findOne(tree, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "ToggleRow"
      && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "title"
        && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "Show photo counts"), `${kind} count toggle`);
    const context = execute(`${declaration(tree, "setExtra")}\nexports.render = () => (${toggle});`, {
      extras: { ...settings.defaultEventGalleryExtras },
      ToggleRow: props => ({ type: "ToggleRow", props }),
    });
    context.setExtras = update => { context.extras = typeof update === "function" ? update(context.extras) : update; };
    assert.equal(context.exports.render().props.checked, false);
    context.exports.render().props.onChange(true);
    assert.equal(context.extras.hideAlbumPhotoCount, false);
    assert.equal(context.exports.render().props.checked, true);
    assert.equal(settings.normalizeEventGallerySettings({ extras: context.extras }).extras.hideAlbumPhotoCount, false);
    context.exports.render().props.onChange(false);
    assert.equal(context.extras.hideAlbumPhotoCount, true);
    assert.equal(context.exports.render().props.checked, false);
    assert.equal(settings.normalizeEventGallerySettings({ extras: context.extras }).extras.hideAlbumPhotoCount, true);
    assert.equal(context.extras.allowSocialSharing, settings.defaultEventGalleryExtras.allowSocialSharing);
  });
}

const page = ast("app/parents/[pin]/page.tsx");
const compactCountLabel = declaration(page, "compactCountLabel");
const gridMetadata = findOne(page, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(page) === "div"
  && node.children.some(child => ts.isJsxExpression(child) && child.expression && ts.isCallExpression(child.expression)
    && child.getText(page).includes("compactCountLabel(activeScenePhotoCount")), "photo grid metadata");
const loadMore = findOne(page, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(page) === "button"
  && node.children.some(child => ts.isJsxText(child) && child.text.trim() === "Load more photos"), "load more button");
const viewerCounter = findOne(page, node => ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression)
  && node.expression.condition.getText(page).includes("hideAlbumPhotoCount")
  && node.expression.whenTrue.getText(page).includes("selectedImageIndex + 1"), "conditional viewer counter")
  .slice(1, -1);

test("welcome and album metadata omit photo totals while keeping album count and access", () => {
  for (const hideAlbumPhotoCount of [true, false]) {
    const metadata = render(variable(page, "galleryMetaItems"), {
      currentGalleryExtras: { hideAlbumPhotoCount }, galleryEventDate: "October 4, 2026", showAlbumOverview: true,
      eventAlbumCount: 4, galleryCopy: { album: "Album" }, images: Array(974), galleryAccessLabel: "Private access",
    }, compactCountLabel);
    assert.equal(metadata.includes("974 photos"), !hideAlbumPhotoCount);
    assert.ok(metadata.includes("4 albums"));
    assert.ok(metadata.includes("Private access"));
  }
});

test("photo grid total obeys the setting without hiding the date or leaving a separator", () => {
  const globals = { activeScenePhotoCount: 427, galleryEventDate: "October 4, 2026", galleryTone: { mutedText: "#888888" } };
  const hidden = render(gridMetadata, { ...globals, currentGalleryExtras: { hideAlbumPhotoCount: true } }, compactCountLabel);
  assert.equal(textOf(hidden), "October 4, 2026");
  const visible = render(gridMetadata, { ...globals, currentGalleryExtras: { hideAlbumPhotoCount: false } }, compactCountLabel);
  assert.equal(textOf(visible), "427 photos · October 4, 2026");
  assert.equal(textOf(render(gridMetadata, {
    ...globals, galleryEventDate: "", currentGalleryExtras: { hideAlbumPhotoCount: true },
  }, compactCountLabel)), "");
});

test("hiding remaining photo totals keeps Load more usable and its loading behavior intact", () => {
  for (const hideAlbumPhotoCount of [true, false]) {
    let limit = 60;
    const button = render(loadMore, {
      currentGalleryExtras: { hideAlbumPhotoCount }, eventPhotoGridRemainingCount: 367,
      visibleImages: Array(427), eventPhotoGridBatchSize: 60, galleryFontFamily: "Arial",
      setEventPhotoGridLimit: update => { limit = update(limit); },
    });
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.match(textOf(button), /Load more photos/);
    assert.equal(textOf(button).includes("367 left"), !hideAlbumPhotoCount);
    assert.equal(nodes(button, "span").length, hideAlbumPhotoCount ? 0 : 1);
    button.props.onClick();
    assert.equal(limit, 120);
  }
});

test("the photo viewer total disappears when counts are hidden and returns when enabled", () => {
  const globals = { selectedImageIndex: 2, visibleImages: Array(427), galleryFontFamily: "Arial" };
  assert.equal(render(viewerCounter, { ...globals, currentGalleryExtras: { hideAlbumPhotoCount: true } }), null);
  const shown = render(viewerCounter, { ...globals, currentGalleryExtras: { hideAlbumPhotoCount: false } });
  assert.equal(shown.type, "div");
  assert.equal(textOf(shown), "3 / 427");
});

test("package photo filters honor saved count visibility without changing selection or empty favorites", () => {
  const picker = findOne(page, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(page) === "div"
    && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
      && attribute.name.getText(page) === "aria-label" && ts.isStringLiteral(attribute.initializer)
      && attribute.initializer.text === "Filter package photos"), "package photo filters");
  for (const hideAlbumPhotoCount of [true, false]) for (const favoriteCount of [0, 3]) {
    const selected = [];
    const tree = render(picker, {
      currentGalleryExtras: { hideAlbumPhotoCount },
      packageAllAssignableImages: Array(60), packageFavoriteAssignableImages: Array(favoriteCount),
      packagePhotoFilter: "all", setPackagePhotoFilter: next => selected.push(next),
      Heart: () => null,
    });
    const filters = nodes(tree, "button");
    assert.deepEqual(filters.map(textOf), hideAlbumPhotoCount
      ? ["All Photos", "Favorites"] : ["All Photos (60)", `Favorites (${favoriteCount})`]);
    assert.equal(filters[0].props["aria-pressed"], true);
    assert.equal(filters[1].props.disabled, favoriteCount === 0);
    filters[0].props.onClick();
    if (favoriteCount) filters[1].props.onClick();
    assert.deepEqual(selected, favoriteCount ? ["all", "favorites"] : ["all"]);
  }
});
