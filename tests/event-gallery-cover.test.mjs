import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function load(path, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL(path, import.meta.url), "utf8")), { exports, ...globals });
  return exports;
}

function findAll(node, type) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => findAll(child, type))];
}

function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return [node.props?.children].flat(Infinity).map(textOf).join(" ");
}

function coverHarness() {
  const hooks = [];
  let cursor = 0;
  const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
  const { EventGalleryCover } = load("../components/parents/event-gallery-cover.tsx", {
    require: name => {
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!(index in hooks)) hooks[index] = initial;
          return [hooks[index], next => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }];
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return { render(props) { cursor = 0; return EventGalleryCover(props); } };
}

const coverProps = (overrides = {}) => ({
  title: "The Giles School",
  clientName: "Caroline Bernaba",
  imageUrl: "/authorized/event-cover.jpg",
  brandName: "White Photo",
  brandLogoUrl: null,
  showStudioMark: true,
  metadata: ["4 albums", "974 photos", "Private access"],
  message: "Welcome to your gallery.",
  buttonLabel: "View albums",
  onEnter: () => {},
  fontFamily: "Arial, sans-serif",
  serifTitle: false,
  overlayOpacity: 0.5,
  ...overrides,
});

test("welcome presents the full cover, client name, and one accessible way to albums", () => {
  let entered = 0;
  const tree = coverHarness().render(coverProps({ onEnter: () => entered++ }));
  assert.equal(tree.type, "section");
  assert.equal(tree.props["aria-label"], "The Giles School");
  assert.equal(tree.props.style.overflowY, "auto");
  assert.equal(findAll(tree, "h1").length, 1);
  assert.equal(textOf(findAll(tree, "h1")[0]), "The Giles School");
  assert.match(textOf(tree), /Caroline Bernaba/);
  assert.match(textOf(tree), /4 albums · 974 photos · Private access/);
  const images = findAll(tree, "img");
  assert.equal(images.length, 1);
  assert.equal(images[0].props.src, "/authorized/event-cover.jpg");
  assert.equal(images[0].props.style.objectFit, "cover");
  assert.equal(images[0].props.alt, "");
  const buttons = findAll(tree, "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.type, "button");
  assert.equal(buttons[0].props.autoFocus, true);
  assert.equal(textOf(buttons[0]), "View albums");
  assert.ok(buttons[0].props.style.minHeight >= 44);
  buttons[0].props.onClick();
  assert.equal(entered, 1);
});

test("broken cover falls back to a readable welcome and a changed image may load", () => {
  const ui = coverHarness(), props = coverProps();
  const cover = findAll(ui.render(props), "img")[0];
  cover.props.onError();
  const fallback = ui.render(props);
  assert.equal(findAll(fallback, "img").length, 0);
  assert.equal(fallback.props.style.color, "#fff");
  assert.equal(fallback.props.style.background, "#151719");
  assert.match(textOf(fallback), /The Giles School/);
  assert.equal(findAll(fallback, "button").length, 1);
  const next = ui.render({ ...props, imageUrl: "/authorized/new-cover.jpg" });
  assert.equal(findAll(next, "img")[0].props.src, "/authorized/new-cover.jpg");
});

test("welcome remains usable without a cover and owner-hidden studio mark stays absent", () => {
  const tree = coverHarness().render(coverProps({ imageUrl: null, showStudioMark: false, brandLogoUrl: "/logo.svg" }));
  assert.equal(findAll(tree, "img").length, 0);
  assert.equal(findAll(tree, "header").length, 0);
  assert.match(textOf(tree), /Caroline Bernaba/);
  assert.doesNotMatch(textOf(tree), /White Photo/);
  assert.equal(findAll(tree, "button").length, 1);
});

const pageSource = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), variables = new Map(), introEntryArguments = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(pageAst));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer.getText(pageAst));
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "setEnteredEventIntro") {
    const argument = node.arguments[0];
    if (argument?.getText(pageAst).includes("activeCollection")) introEntryArguments.push(argument.getText(pageAst));
  }
  ts.forEachChild(node, collect);
}
collect(pageAst);

function evaluate(expression, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(`exports.result = (${expression});`), { exports, ...globals });
  return exports.result;
}

test("every gallery language gives both welcome destinations a readable button label", () => {
  const translations = evaluate(variables.get("galleryTranslations"));
  for (const [locale, copy] of Object.entries(translations)) {
    for (const key of ["viewAlbums", "viewPhotos"]) {
      assert.ok(copy[key]?.trim(), `${locale} is missing ${key}`);
      const tree = coverHarness().render(coverProps({ buttonLabel: copy[key] }));
      assert.equal(textOf(findAll(tree, "button")[0]), copy[key]);
    }
  }
});

const coverVisibility = overrides => evaluate(variables.get("showEventCover"), {
  isSchoolMode: false,
  currentGalleryBranding: { introEnabled: true },
  enteredEventIntro: false,
  activeView: "photos",
  initialTabHint: "",
  checkoutStatus: "",
  ...overrides,
});

test("welcome entry respects owner settings and does not interrupt other portal destinations", () => {
  assert.ok(variables.has("showEventCover"));
  assert.equal(coverVisibility(), true);
  for (const overrides of [
    { currentGalleryBranding: { introEnabled: false } },
    { isSchoolMode: true },
    { enteredEventIntro: true },
    { activeView: "orders" },
    { activeView: "favorites" },
    { activeView: "store" },
    { initialTabHint: "orders" },
    { checkoutStatus: "success" },
    { checkoutStatus: "cancel" },
  ]) assert.equal(coverVisibility(overrides), false, JSON.stringify(overrides));
});

test("an album-specific access entry bypasses the welcome while project entry shows it", () => {
  assert.equal(introEntryArguments.length, 1);
  const clean = value => (value ?? "").trim();
  for (const activeCollection of [null, { id: "" }, { id: "   " }]) {
    const enteredEventIntro = evaluate(introEntryArguments[0], { activeCollection, clean });
    assert.equal(enteredEventIntro, false);
    assert.equal(coverVisibility({ enteredEventIntro }), true);
  }
  const enteredEventIntro = evaluate(introEntryArguments[0], { activeCollection: { id: "authorized-album" }, clean });
  assert.equal(enteredEventIntro, true);
  assert.equal(coverVisibility({ enteredEventIntro }), false);
});

test("turning off Use Event Cover on Intro does not request the project photo", () => {
  assert.ok(variables.has("introImageUrl"));
  const hiddenImage = evaluate(variables.get("introImageUrl"), {
    currentGalleryBranding: { useCoverAsIntro: false }, heroImageUrl: "/project-cover.jpg",
  });
  assert.equal(hiddenImage, null);
  assert.equal(findAll(coverHarness().render(coverProps({ imageUrl: hiddenImage })), "img").length, 0);
  assert.equal(evaluate(variables.get("introImageUrl"), {
    currentGalleryBranding: { useCoverAsIntro: true }, heroImageUrl: "/project-cover.jpg",
  }), "/project-cover.jpg");
});

function entryHarness(overrides = {}) {
  const state = [];
  const sandbox = {
    exports: {},
    eventHasAlbums: true,
    activeEventCollectionId: null,
    eventPhotoGridInitialLimit: 60,
    eventAlbumChoices: [{ collectionId: "authorized-album", value: "album:authorized-album" }],
    currentGalleryExtras: { hideAllPhotosAlbum: true },
    ...overrides,
  };
  for (const name of ["EnteredEventIntro", "ActiveEventCollectionId", "SelectedImageIndex", "EventPhotoGridLimit", "EventPhotoStage", "ActiveView"]) {
    sandbox[`set${name}`] = value => state.push({ name, value });
  }
  const names = ["enterEventGallery", "openAlbumsOverview", "openEventPhotoGrid"];
  for (const name of names) assert.ok(functions.has(name), `Missing ${name}`);
  vm.runInNewContext(compile(`${names.map(name => functions.get(name)).join("\n")}\nexports.enter = enterEventGallery;`), sandbox);
  return { state, enter: sandbox.exports.enter };
}

test("View albums dismisses the welcome into the chooser without selecting All Photos", () => {
  const page = entryHarness();
  page.enter();
  assert.deepEqual(page.state, [
    { name: "EnteredEventIntro", value: true },
    { name: "ActiveEventCollectionId", value: null },
    { name: "SelectedImageIndex", value: 0 },
    { name: "EventPhotoStage", value: "albums" },
    { name: "ActiveView", value: "photos" },
  ]);
  assert.equal(page.state.some(update => update.name === "EventPhotoStage" && update.value === "grid"), false);
});

test("View photos dismisses the welcome into the grid when the gallery has no albums", () => {
  const page = entryHarness({ eventHasAlbums: false });
  page.enter();
  assert.deepEqual(page.state, [
    { name: "EnteredEventIntro", value: true },
    { name: "ActiveEventCollectionId", value: null },
    { name: "SelectedImageIndex", value: 0 },
    { name: "EventPhotoGridLimit", value: 60 },
    { name: "EventPhotoStage", value: "grid" },
    { name: "ActiveView", value: "photos" },
  ]);
});
