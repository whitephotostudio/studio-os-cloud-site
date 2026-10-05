import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(path, modules = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")), {
    exports, ...globals,
    require(name) { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; },
  });
  return exports;
}
const { defaultEventGalleryBranding, defaultEventGallerySettings } = load("lib/event-gallery-settings.ts");
const presentation = load("lib/event-gallery-presentation.ts");
const branding = overrides => ({ ...defaultEventGalleryBranding, ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));
const findAll = (node, type) => !node || typeof node !== "object" ? []
  : [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => findAll(child, type))];
const textOf = node => typeof node === "string" || typeof node === "number" ? String(node)
  : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(textOf).join(" ");

function heroHarness() {
  const state = [];
  const timers = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const previewRetry = load("lib/portal-preview-retry.ts", {}, {
    URL, setTimeout(callback, delay) { timers.push({ callback, delay }); },
  });
  const { EventAlbumHero } = load("components/parents/event-album-hero.tsx", {
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol.for("fragment") },
    "@/lib/portal-preview-retry": previewRetry,
  });
  return {
    render(props) { cursor = 0; return EventAlbumHero(props); },
    get pendingTimers() { return timers.length; },
    runNextTimer(delay) {
      const timer = timers.shift();
      assert.ok(timer, "A preview retry must have been scheduled");
      assert.equal(timer.delay, delay);
      timer.callback();
    },
  };
}
const imageTarget = photo => ({ src: photo.props.src, alt: photo.props.alt, isConnected: true, dataset: {}, style: { opacity: "1" } });
const heroProps = overrides => ({
  title: "The Giles School — Terry Fox event", imageUrl: "/authorized/album-cover.jpg",
  imageFilter: "grayscale(1)", metadata: ["427 photos", "October 15", "Private access"],
  branding: branding(), tone: presentation.galleryPresentationTone(branding()),
  overlayOpacity: 0.34, accentColor: "#991b1b", ...overrides,
});

test("album hero follows left/center alignment and keeps the actual album title and metadata", () => {
  for (const heroTextAlign of ["left", "center"]) {
    const tree = heroHarness().render(heroProps({ branding: branding({ heroTextAlign }) }));
    const content = findAll(tree, "div").find(node => node.props.className === "event-album-hero-content");
    assert.equal(tree.type, "header");
    assert.equal(content.props.style.textAlign, heroTextAlign);
    assert.equal(content.props.style.alignItems, heroTextAlign === "center" ? "center" : "flex-start");
    assert.equal(textOf(findAll(tree, "h2")[0]), "The Giles School — Terry Fox event");
    assert.equal(textOf(findAll(tree, "p")[0]), "427 photos · October 15 · Private access");
    assert.equal(findAll(tree, "h2")[0].props.style.overflowWrap, "anywhere");
    assert.equal(findAll(tree, "button").length, 0);
  }
});

test("album hero themes change presentation while the saved accent remains visible", () => {
  const variants = ["signature", "editorial", "cinema"].map(themePreset => {
    const tree = heroHarness().render(heroProps({ branding: branding({ themePreset }), accentColor: "#c4a574" }));
    const accent = findAll(tree, "span").find(node => node.props.style?.height === 3);
    assert.equal(accent.props.style.background, "#c4a574");
    assert.equal(accent.props["aria-hidden"], "true");
    return { tree, title: findAll(tree, "h2")[0] };
  });
  assert.equal(variants[0].title.props.style.fontWeight, 600);
  assert.equal(variants[1].title.props.style.fontWeight, 400);
  assert.equal(variants[1].title.props.style.fontStyle, "italic");
  assert.equal(variants[1].tree.props.style.borderRadius, 0);
  assert.equal(variants[2].title.props.style.textTransform, "uppercase");
  assert.notEqual(variants[2].title.props.style.letterSpacing, variants[0].title.props.style.letterSpacing);
});

test("album photos use the saved filter/overlay and failure restores the selected tone without losing text", () => {
  const tone = presentation.galleryPresentationTone(branding({ backgroundMode: "light", tone: "graphite" }));
  const props = heroProps({ tone, overlayOpacity: 0.5 }), ui = heroHarness();
  const first = ui.render(props);
  const photo = findAll(first, "img")[0];
  assert.equal(photo.props.src, props.imageUrl);
  assert.equal(photo.props.alt, "");
  assert.equal(photo.props.loading, "lazy");
  assert.equal(photo.props.style.objectFit, "cover");
  assert.equal(photo.props.style.filter, props.imageFilter);
  assert.equal(first.props.style.color, "#ffffff");
  assert.ok(findAll(first, "span").some(node => node.props.style?.background === "rgba(0,0,0,0.5)"));
  photo.props.onError({ currentTarget: imageTarget(photo) });
  assert.equal(ui.pendingTimers, 0, "Ordinary owner cover files must use the fallback immediately");
  const failed = ui.render(props);
  assert.equal(findAll(failed, "img").length, 0);
  assert.equal(failed.props.style.background, tone.background);
  assert.equal(failed.props.style.color, tone.text);
  assert.equal(failed.props.style.border, `1px solid ${tone.border}`);
  assert.equal(findAll(failed, "h2")[0].props.style.textShadow, undefined);
  assert.match(textOf(failed), /Terry Fox event/);
  assert.match(textOf(failed), /427 photos/);
  assert.equal(findAll(ui.render({ ...props, imageUrl: "/authorized/replacement.jpg" }), "img")[0].props.src, "/authorized/replacement.jpg");
});

test("protected album hero previews retry twice before falling back without losing the album text", () => {
  for (const scope of ["event", "school"]) {
    const props = heroProps({ imageUrl: `/api/portal/${scope}-preview/cover.jpg?token=signed%2Btoken` });
    const ui = heroHarness(), photo = findAll(ui.render(props), "img")[0], image = imageTarget(photo);
    for (const [retry, delay] of [[1, 1500], [2, 60000]]) {
      photo.props.onError({ currentTarget: image });
      assert.equal(findAll(ui.render(props), "img").length, 1, "A temporary protected preview error must keep the hero photo available");
      assert.equal(ui.pendingTimers, 1);
      assert.equal(image.alt, "Preview temporarily unavailable. Retrying.");
      ui.runNextTimer(delay);
      const retriedUrl = new URL(image.src);
      assert.equal(retriedUrl.searchParams.get("token"), "signed+token");
      assert.equal(retriedUrl.searchParams.get("previewRetry"), String(retry));
    }
    photo.props.onError({ currentTarget: image });
    const failed = ui.render(props);
    assert.equal(ui.pendingTimers, 0);
    assert.equal(findAll(failed, "img").length, 0);
    assert.equal(failed.props.style.background, props.tone.background);
    assert.equal(failed.props.style.color, props.tone.text);
    assert.match(textOf(failed), /Terry Fox event/);
    assert.match(textOf(failed), /427 photos/);
  }
});

test("album hero preview retries cannot replace a disconnected image or a newer image source", () => {
  for (const staleReason of ["disconnected", "replaced"]) {
    const props = heroProps({ imageUrl: "/api/portal/event-preview/cover.jpg?token=signed" });
    const ui = heroHarness(), photo = findAll(ui.render(props), "img")[0], image = imageTarget(photo);
    photo.props.onError({ currentTarget: image });
    if (staleReason === "disconnected") image.isConnected = false;
    else image.src = "/api/portal/event-preview/new-cover.jpg?token=new-signed";
    const source = image.src;
    ui.runNextTimer(1500);
    assert.equal(image.src, source);
    assert.equal(ui.pendingTimers, 0);
  }
});

test("photo-free album headers and hidden metadata remain readable without adding invented totals", () => {
  const props = heroProps({ imageUrl: null, metadata: [] });
  const tree = heroHarness().render(props);
  assert.equal(findAll(tree, "img").length, 0);
  assert.equal(findAll(tree, "p").length, 0);
  assert.equal(tree.props.style.color, props.tone.text);
  assert.equal(textOf(findAll(tree, "h2")[0]), props.title);
  assert.doesNotMatch(textOf(tree), /photos/);
});

function luminance(color) {
  assert.match(color, /^#[\da-f]{6}$/i);
  const channels = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test("all six tone palettes provide distinct light/dark surfaces with readable primary text", () => {
  const backgrounds = new Set();
  for (const backgroundMode of ["light", "dark"]) for (const toneName of ["ink", "graphite", "smoke"]) {
    const tone = presentation.galleryPresentationTone(branding({ backgroundMode, tone: toneName }));
    for (const key of ["background", "surface", "border", "text", "mutedText"]) assert.match(tone[key], /^#[\da-f]{6}$/i);
    assert.match(tone.surfaceMuted, /^rgba\(/);
    assert.match(tone.heroOverlay, /^rgba\(/);
    const background = luminance(tone.background), foreground = luminance(tone.text);
    assert.equal(background > 0.8, backgroundMode === "light");
    assert.ok((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05) >= 7);
    backgrounds.add(tone.background);
  }
  assert.equal(backgrounds.size, 6);
  for (const backgroundMode of ["light", "dark"]) {
    assert.deepEqual(plain(presentation.galleryPresentationTone(branding({ backgroundMode, tone: "unknown" }))),
      plain(presentation.galleryPresentationTone(branding({ backgroundMode, tone: "ink" }))));
  }
});

test("saved accent palettes expose the same usable roles and unsupported values retain studio red", () => {
  const solids = new Set();
  for (const accentColor of ["studio-red", "champagne", "ivory"]) {
    const accent = presentation.galleryPresentationAccent(branding({ accentColor }));
    for (const key of ["solid", "strong", "text"]) assert.match(accent[key], /^#[\da-f]{6}$/i);
    for (const key of ["muted", "border"]) assert.match(accent[key], /^rgba\(/);
    solids.add(accent.solid);
  }
  assert.equal(solids.size, 3);
  assert.deepEqual(plain(presentation.galleryPresentationAccent(branding({ accentColor: "unknown" }))),
    plain(presentation.galleryPresentationAccent(branding({ accentColor: "studio-red" }))));
});

test("legacy/default intro labels resolve to the current destination while custom labels remain owner controlled", () => {
  for (const defaultLabel of ["View albums", "View photos", "Voir les albums"]) {
    for (const savedLabel of ["", "   ", "Enter Gallery", "  Enter Gallery  ", defaultEventGalleryBranding.introCtaLabel]) {
      assert.equal(presentation.galleryIntroButtonLabel(savedLabel, defaultLabel), defaultLabel);
    }
    assert.equal(presentation.galleryIntroButtonLabel("  Explore your photographs  ", defaultLabel), "Explore your photographs");
  }
});

// Evaluate the actual JSX bindings rather than restating the client prop mapping.
const pageSource = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements = new Map();
const toolbarStyles = new Map();
const toolbarHandlers = new Map([
  ["handleShareGallery", "share"],
  ["() => setBlackWhitePreviewEnabled((prev) => !prev)", "blackWhite"],
  ["selectBuyAllPackage", "buyAll"],
  ["downloadGalleryImages", "download"],
  ["() => setActiveView(\"favorites\")", "favorites"],
  ["basketItemCount > 0 ? openCartCheckout : openBuyDrawer", "store"],
]);
function isInsideGalleryToolbar(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (!ts.isJsxElement(ancestor)) continue;
    if (ancestor.children.some(child => ts.isJsxElement(child) && child.openingElement.tagName.getText(pageAst) === "button"
      && child.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
        && attribute.name.getText(pageAst) === "onClick" && attribute.initializer && ts.isJsxExpression(attribute.initializer)
        && attribute.initializer.expression?.getText(pageAst) === "openCombineDrawer"))) return true;
  }
  return false;
}
function collect(node) {
  if (ts.isJsxSelfClosingElement(node) && ["EventGalleryCover", "EventAlbumHero"].includes(node.tagName.getText(pageAst))) elements.set(node.tagName.getText(pageAst), node);
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(pageAst) === "button" && isInsideGalleryToolbar(node)) {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const handler = attributes.find(attribute => attribute.name.getText(pageAst) === "onClick")?.initializer;
    const action = handler && ts.isJsxExpression(handler) ? toolbarHandlers.get(handler.expression?.getText(pageAst)) : null;
    if (action) {
      const style = attributes.find(attribute => attribute.name.getText(pageAst) === "style")?.initializer;
      assert.ok(style && ts.isJsxExpression(style), `${action} toolbar button must have an evaluable style`);
      assert.ok(!toolbarStyles.has(action), `${action} toolbar handler must identify one button`);
      toolbarStyles.set(action, style.expression.getText(pageAst));
    }
  }
  ts.forEachChild(node, collect);
}
collect(pageAst);
function evaluate(expression, globals) {
  const exports = {};
  vm.runInNewContext(compile(`exports.result = (${expression});`), { exports, ...globals });
  return exports.result;
}
function boundProps(name, globals) {
  const node = elements.get(name);
  assert.ok(node, `${name} is missing from the client page`);
  return Object.fromEntries(node.attributes.properties.map(attribute => {
    assert.ok(ts.isJsxAttribute(attribute), "Unexpected spread hides client presentation settings");
    const value = !attribute.initializer ? true : ts.isJsxExpression(attribute.initializer)
      ? evaluate(attribute.initializer.expression.getText(pageAst), globals) : attribute.initializer.text;
    return [attribute.name.getText(pageAst), value];
  }));
}

test("gallery toolbar actions remain readable in the saved light and dark tones", () => {
  assert.equal(toolbarStyles.size, toolbarHandlers.size);
  for (const backgroundMode of ["light", "dark"]) {
    const galleryTone = presentation.galleryPresentationTone(branding({ backgroundMode, tone: "graphite" }));
    const globals = {
      galleryTone, isEventImageStage: true, isLightGallery: backgroundMode === "light", isMobileViewport: false,
      blackWhitePreviewActive: false, orderingDisabled: false, downloadingGallery: false,
      galleryDownloadAccess: { canDownload: true, audience: "gallery" }, activeEventCollectionId: "album-id", favorites: new Set(),
    };
    for (const [action, expression] of toolbarStyles) {
      const style = evaluate(expression, globals);
      assert.equal(style.background, "transparent", `${action} remains a transparent image-stage action`);
      assert.equal(style.color, galleryTone.text, `${action} must follow the saved ${backgroundMode} tone`);
    }
    for (const action of ["buyAll", "store"]) {
      assert.equal(evaluate(toolbarStyles.get(action), { ...globals, orderingDisabled: true }).color, galleryTone.mutedText);
    }
    for (const disabledState of [
      { downloadingGallery: true },
      { galleryDownloadAccess: { canDownload: false, audience: "gallery" } },
      { galleryDownloadAccess: { canDownload: true, audience: "album" }, activeEventCollectionId: null },
    ]) {
      assert.equal(evaluate(toolbarStyles.get("download"), { ...globals, ...disabledState }).color, galleryTone.mutedText);
    }
    const filledStore = evaluate(toolbarStyles.get("store"), { ...globals, isEventImageStage: false });
    assert.equal(filledStore.color, backgroundMode === "light" ? "#fff" : "#000");
    assert.equal(filledStore.background, backgroundMode === "light" ? "#111111" : "#fff");
  }
});

test("client welcome bindings pass the saved layout/theme/tone/accent and custom entry label", () => {
  const saved = branding({ introLayout: "minimal", themePreset: "cinema", fontPreset: "oswald", introCtaLabel: "Explore", showStudioMark: false });
  const tone = presentation.galleryPresentationTone(saved), accent = presentation.galleryPresentationAccent(saved);
  const enter = () => {};
  const props = boundProps("EventGalleryCover", {
    currentGalleryBranding: saved, galleryHeadline: "Owner title", galleryClientLabel: "Owner client",
    introImageUrl: null, galleryImageFilter: "grayscale(1)", eventBrandLabel: "Owner studio", displayStudioLogoUrl: "/owner-logo.svg",
    galleryMetaItems: ["Private access"], customGalleryDescription: "Owner welcome", defaultEventGallerySettings,
    clean: value => (value ?? "").trim(), ...presentation,
    eventHasAlbums: true, galleryCopy: { viewAlbums: "View albums", viewPhotos: "View photos" },
    enterEventGallery: enter, galleryFontFamily: "Owner selected font", usesSerifHero: () => false,
    heroOverlayTint: 0.5, galleryTone: tone, galleryAccent: accent,
  });
  assert.equal(props.layout, "minimal");
  assert.equal(props.themePreset, "cinema");
  assert.equal(props.tone, tone);
  assert.equal(props.accentColor, accent.solid);
  assert.equal(props.buttonLabel, "Explore");
  assert.equal(props.fontFamily, "Owner selected font");
  assert.equal(props.showStudioMark, false);
  assert.equal(props.imageUrl, null);
  assert.equal(props.overlayOpacity, 0.5);
  assert.equal(props.onEnter, enter);
  assert.equal(props.preview, undefined);
});

test("selected album hero bindings preserve saved alignment and omit counts when hidden", () => {
  const saved = branding({ heroTextAlign: "center", themePreset: "editorial" });
  for (const hideAlbumPhotoCount of [true, false]) {
    const props = boundProps("EventAlbumHero", {
      galleryHeaderTitle: "Selected album", activeSceneCoverUrl: "/authorized/selected-album.jpg",
      galleryImageFilter: "grayscale(1)", currentGalleryExtras: { hideAlbumPhotoCount },
      compactCountLabel: count => `${count} photos`, activeScenePhotoCount: 74,
      galleryEventDate: "October 15", galleryAccessLabel: "Private access",
      currentGalleryBranding: saved, galleryTone: presentation.galleryPresentationTone(saved),
      heroOverlayTint: 0.3, galleryAccent: presentation.galleryPresentationAccent(saved),
    });
    assert.equal(props.branding, saved);
    assert.equal(props.imageUrl, "/authorized/selected-album.jpg");
    assert.equal(props.overlayOpacity, 0.3);
    const tree = heroHarness().render(props);
    assert.equal(textOf(tree).includes("74 photos"), !hideAlbumPhotoCount);
    assert.match(textOf(tree), /Selected album/);
    assert.equal(findAll(tree, "div")[0].props.style.textAlign, "center");
  }
  const node = elements.get("EventAlbumHero");
  assert.ok(ts.isConditionalExpression(node.parent));
  for (const showHeroHeader of [true, false]) assert.equal(evaluate(node.parent.condition.getText(pageAst), { currentGalleryBranding: { showHeroHeader } }), showHeroHeader);
});
