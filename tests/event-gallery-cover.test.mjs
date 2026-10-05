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

function coverHarness({ reducedMotion = false, cachedImageUrls = [], brokenCachedImageUrls = [] } = {}) {
  const hooks = [];
  const timers = new Map(), domNodes = new Map();
  let cursor = 0, now = 0, nextTimer = 0, changed = false, effects = [], mountedRefs = new Set();
  let currentProps, tree, focused = 0;
  const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
  const { EventGalleryCover } = load("../components/parents/event-gallery-cover.tsx", {
    window: {
      matchMedia: query => ({ matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion }),
      setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      requestAnimationFrame(callback) { const id = ++nextTimer; timers.set(id, { callback, at: now + 16 }); return id; },
      cancelAnimationFrame(id) { timers.delete(id); },
    },
    require: name => {
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!(index in hooks)) hooks[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
          return [hooks[index].value, next => {
            const value = typeof next === "function" ? next(hooks[index].value) : next;
            if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; changed = true; }
          }];
        },
        useRef(initial) {
          const index = cursor++;
          if (!(index in hooks)) hooks[index] = { kind: "ref", value: { current: initial } };
          return hooks[index].value;
        },
        useEffect(callback, dependencies) {
          const index = cursor++;
          const previous = hooks[index];
          if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
            effects.push({ index, callback, dependencies });
          }
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/lib/portal-preview-retry") return load("../lib/portal-preview-retry.ts", { URL });
      throw new Error(`Unexpected module ${name}`);
    },
  });

  function commitRefs() {
    const nextRefs = new Set();
    for (const type of ["img", "button"]) for (const node of findAll(tree, type)) {
      const ref = node.props.ref;
      if (!ref) continue;
      nextRefs.add(ref);
      const key = type === "img" ? `img:${node.props.src}` : "button";
      if (!domNodes.has(key)) domNodes.set(key, {
        src: node.props.src, isConnected: true, alt: node.props.alt, dataset: {}, style: { opacity: "1" },
        complete: type === "img" && [...cachedImageUrls, ...brokenCachedImageUrls].includes(node.props.src),
        naturalWidth: type === "img" && cachedImageUrls.includes(node.props.src) ? 1600 : 0,
        focus() { focused++; },
      });
      if (typeof ref === "function") ref(domNodes.get(key));
      else ref.current = domNodes.get(key);
    }
    for (const ref of mountedRefs) if (!nextRefs.has(ref)) {
      if (typeof ref === "function") ref(null); else { if (ref.current) ref.current.isConnected = false; ref.current = null; }
    }
    mountedRefs = nextRefs;
  }
  function render(props = currentProps) {
    currentProps = props;
    for (let pass = 0; pass < 10; pass++) {
      changed = false; cursor = 0; effects = [];
      tree = EventGalleryCover(props);
      commitRefs();
      for (const effect of effects) {
        hooks[effect.index]?.cleanup?.();
        hooks[effect.index] = { kind: "effect", dependencies: effect.dependencies, cleanup: effect.callback() };
      }
      if (!changed) return tree;
    }
    throw new Error("Cover effects did not settle");
  }
  return {
    render,
    advance(milliseconds) {
      const target = now + milliseconds;
      for (let pass = 0; pass < 100; pass++) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = target; return tree; }
        now = next[1].at; timers.delete(next[0]); next[1].callback();
        if (changed) render();
      }
      throw new Error("Cover timers did not settle");
    },
    unmount() { for (const hook of hooks) { if (hook.kind === "effect") hook.cleanup?.(); if(hook.kind === "ref" && hook.value.current) hook.value.current.isConnected=false; } },
    get focused() { return focused; },
    get pendingTimers() { return timers.size; },
  };
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

test("authorized cover preview retries stay bounded while welcome access and loading reveal remain usable", () => {
  const ui=coverHarness(),props=coverProps({imageUrl:"/api/portal/event-preview/authorized.jpg?token=signed"});
  let tree=ui.render(props),photo=findAll(tree,"img")[0],image=photo.props.ref.current;
  photo.props.onError({currentTarget:image});tree=ui.render(props);
  assert.equal(findAll(tree,"img").length,1,"temporary preview error must not permanently remove the authorized cover");
  ui.advance(1500);assert.match(image.src,/previewRetry=1/);
  assert.equal(ui.advance(1000).props["data-reveal-ready"],true,"welcome still opens after its2500ms fallback");
  photo.props.onError({currentTarget:image});ui.advance(60000);assert.match(image.src,/previewRetry=2/);
  photo.props.onLoad();assert.equal(ui.render(props).props["data-reveal-ready"],true);
  photo.props.onError({currentTarget:image});tree=ui.render(props);
  assert.equal(findAll(tree,"img").length,0,"exhausted preview retry keeps the existing safe fallback");
  assert.equal(findAll(tree,"button").length,1);
});

test("welcome presents the full cover, client name, and one accessible way to albums", () => {
  let entered = 0;
  const ui = coverHarness(), props = coverProps({ onEnter: () => entered++ });
  const first = ui.render(props);
  findAll(first, "img")[0].props.onLoad();
  const tree = ui.render(props);
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
  assert.equal(buttons[0].props.autoFocus, undefined);
  assert.equal(textOf(buttons[0]), "View albums");
  assert.ok(buttons[0].props.style.minHeight >= 44);
  buttons[0].props.onClick();
  assert.equal(entered, 1);
});

test("broken cover falls back to a readable welcome and a changed image may load", () => {
  const ui = coverHarness(), props = coverProps();
  const cover = findAll(ui.render(props), "img")[0];
  cover.props.onError({currentTarget:cover.props.ref.current});
  const fallback = ui.render(props);
  assert.equal(findAll(fallback, "img").length, 0);
  assert.equal(fallback.props.style.color, "#fff");
  assert.equal(fallback.props.style.background, "#151719");
  assert.match(textOf(fallback), /The Giles School/);
  assert.equal(findAll(fallback, "button").length, 1);
  assert.equal(fallback.props["data-reveal-ready"], true);
  const next = ui.render({ ...props, imageUrl: "/authorized/new-cover.jpg" });
  assert.equal(findAll(next, "img")[0].props.src, "/authorized/new-cover.jpg");
  assert.equal(next.props["data-reveal-ready"], false);
});

test("welcome remains usable without a cover and owner-hidden studio mark stays absent", () => {
  const tree = coverHarness().render(coverProps({ imageUrl: null, showStudioMark: false, brandLogoUrl: "/logo.svg" }));
  assert.equal(findAll(tree, "img").length, 0);
  assert.equal(findAll(tree, "header").length, 0);
  assert.match(textOf(tree), /Caroline Bernaba/);
  assert.doesNotMatch(textOf(tree), /White Photo/);
  assert.equal(findAll(tree, "button").length, 1);
  assert.equal(tree.props["data-reveal-ready"], true);
});

test("the photo appears first, then loaded media releases the staged welcome and delayed focus", () => {
  const ui = coverHarness(), props = coverProps();
  const first = ui.render(props);
  assert.equal(first.props["data-reveal-ready"], false);
  assert.equal(ui.focused, 0);
  const photo = findAll(first, "img")[0];
  assert.doesNotMatch(photo.props.className ?? "", /event-cover-reveal/);
  assert.match(findAll(first, "h1")[0].props.className, /event-cover-reveal event-cover-title/);
  assert.match(findAll(first, "p").find(node => textOf(node) === props.clientName).props.className, /event-cover-client/);
  assert.match(findAll(first, "button")[0].props.className, /event-cover-action/);
  const css = textOf(findAll(first, "style")[0]);
  assert.match(css, /\.event-cover-reveal\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;/);
  assert.match(css, /\[data-reveal-ready="true"\]\s+\.event-cover-reveal\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/);
  const delays = ["title", "client", "details", "action"].map(name => {
    const match = css.match(new RegExp(`\\.event-cover-${name}\\s*\\{\\s*--event-cover-delay:\\s*(\\d+)ms;`));
    assert.ok(match, `Missing ${name} animation delay`);
    return Number(match[1]);
  });
  for (let index = 1; index < delays.length; index++) assert.ok(delays[index] > delays[index - 1]);
  photo.props.onLoad();
  assert.equal(ui.render(props).props["data-reveal-ready"], true);
  ui.advance(999);
  assert.equal(ui.focused, 0);
  ui.advance(1);
  assert.equal(ui.focused, 1);
});

test("cached complete images release the welcome without waiting for a load event", () => {
  const props = coverProps(), ui = coverHarness({ cachedImageUrls: [props.imageUrl] });
  assert.equal(ui.render(props).props["data-reveal-ready"], false);
  const revealed = ui.advance(16);
  assert.equal(revealed.props["data-reveal-ready"], true);
  ui.advance(1000);
  assert.equal(ui.focused, 1);
});

test("slow and broken cached media never prevent access after the fallback deadline", () => {
  const props = coverProps();
  for (const options of [{}, { brokenCachedImageUrls: [props.imageUrl] }]) {
    const ui = coverHarness(options);
    assert.equal(ui.render(props).props["data-reveal-ready"], false);
    assert.equal(ui.advance(2499).props["data-reveal-ready"], false);
    assert.equal(ui.advance(1).props["data-reveal-ready"], true);
    assert.equal(findAll(ui.render(props), "button").length, 1);
    ui.advance(1000);
    assert.equal(ui.focused, 1);
  }
});

test("failed media and galleries without a cover reveal the welcome and keep keyboard entry usable", () => {
  const props = coverProps(), ui = coverHarness();
  const failedPhoto=findAll(ui.render(props), "img")[0];
  failedPhoto.props.onError({currentTarget:failedPhoto.props.ref.current});
  assert.equal(ui.render(props).props["data-reveal-ready"], true);
  ui.advance(1000);
  assert.equal(ui.focused, 1);
  const noPhoto = coverHarness();
  const tree = noPhoto.render(coverProps({ imageUrl: null }));
  assert.equal(tree.props["data-reveal-ready"], true);
  noPhoto.advance(1000);
  assert.equal(noPhoto.focused, 1);
});

test("reduced motion makes welcome copy immediately visible and focuses without an animation delay", () => {
  const ui = coverHarness({ reducedMotion: true }), props = coverProps();
  const first = ui.render(props);
  const css = textOf(findAll(first, "style")[0]);
  const reducedRule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}/)?.[1];
  assert.ok(reducedRule);
  assert.match(reducedRule, /\.event-gallery-cover\s+\.event-cover-reveal,/);
  assert.match(reducedRule, /opacity:\s*1;\s*visibility:\s*visible;\s*transform:\s*none;\s*transition:\s*none;/);
  assert.equal(first.props["data-reveal-ready"], false);
  findAll(first, "img")[0].props.onLoad();
  assert.equal(ui.render(props).props["data-reveal-ready"], true);
  ui.advance(0);
  assert.equal(ui.focused, 1);
});

test("changing photos restarts readiness and unmount cancels fallback and focus work", () => {
  const ui = coverHarness(), props = coverProps();
  const photo = findAll(ui.render(props), "img")[0];
  photo.props.onLoad();
  ui.render(props);
  ui.advance(400);
  const nextProps = { ...props, imageUrl: "/authorized/another-cover.jpg" };
  assert.equal(ui.render(nextProps).props["data-reveal-ready"], false);
  ui.advance(600);
  assert.equal(ui.focused, 0);
  assert.ok(ui.pendingTimers > 0);
  ui.unmount();
  assert.equal(ui.pendingTimers, 0);
  ui.advance(5000);
  assert.equal(ui.focused, 0);
});

const lightTone = { background: "#f4f6f8", surface: "#ffffff", text: "#27313b", mutedText: "#6b7280", border: "#d7dde5" };
const divWithClass = (tree, className) => findAll(tree, "div").find(node => node.props.className === className);

test("saved welcome layouts change the photo and text arrangement without changing gallery entry", () => {
  for (const layout of [undefined, "centered", "split", "minimal"]) {
    let entered = 0;
    const tree = coverHarness().render(coverProps({ layout, tone: lightTone, onEnter: () => entered++ }));
    assert.equal(tree.props["data-layout"], layout ?? "centered");
    const frame = divWithClass(tree, "event-cover-frame");
    const panel = divWithClass(tree, "event-cover-panel");
    const copy = divWithClass(tree, "event-cover-copy");
    assert.equal(findAll(frame, "img").length, 1);
    assert.equal(findAll(panel, "img").length, layout === "minimal" ? 1 : 0);
    assert.equal(findAll(copy, "img").length, layout === "minimal" ? 1 : 0);
    assert.equal(tree.props.style.color, layout === "split" || layout === "minimal" ? lightTone.text : "#fff");
    if (layout === "split") {
      assert.equal(panel.props.style.background, lightTone.surface);
      assert.equal(panel.props.style.border, `1px solid ${lightTone.border}`);
    }
    const css = textOf(findAll(tree, "style")[0]);
    assert.match(css, /data-layout="split"[\s\S]*grid-template-columns:\s*minmax\(0, 1\.05fr\) minmax\(0, 1fr\)/);
    assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*grid-template-columns:\s*1fr/);
    assert.match(css, /data-layout="minimal"[^}]*width:\s*min\(340px, 68%\)/);
    findAll(tree, "button")[0].props.onClick();
    assert.equal(entered, 1);
  }
});

test("all layouts honor the selected tone when there is no usable photo", () => {
  for (const layout of ["centered", "split", "minimal"]) {
    const ui = coverHarness(), props = coverProps({ layout, tone: lightTone });
    findAll(ui.render(props), "img")[0].props.onError({ currentTarget: { src: props.imageUrl, isConnected: true, alt: "", dataset: {} } });
    const failed = ui.render(props);
    assert.equal(failed.props.style.background, lightTone.background);
    assert.equal(failed.props.style.color, lightTone.text);
    assert.equal(failed.props["data-has-image"], false);
    assert.equal(failed.props["data-reveal-ready"], true);
    assert.equal(divWithClass(failed, "event-cover-photo-overlay"), undefined);
    assert.equal(divWithClass(failed, "event-cover-panel").props.style.background, undefined);
    assert.equal(findAll(failed, "p").find(node => textOf(node) === props.message).props.style.color, lightTone.mutedText);
    const absent = ui.render({ ...props, imageUrl: null });
    assert.equal(absent.props.style.background, lightTone.background);
    assert.equal(absent.props.style.color, lightTone.text);
    assert.equal(findAll(absent, "img").length, 0);
  }
});

test("signature, editorial, and cinema use distinct typography while keeping the selected font", () => {
  const titles = ["signature", "editorial", "cinema"].map(themePreset => {
    const tree = coverHarness().render(coverProps({ themePreset, fontFamily: "Chosen Studio Font" }));
    assert.equal(tree.props["data-theme"], themePreset);
    const title = findAll(tree, "h1")[0];
    assert.equal(title.props.style.fontFamily, "Chosen Studio Font");
    assert.equal(title.props.style.overflowWrap, "anywhere");
    return title.props.style;
  });
  assert.equal(titles[0].fontWeight, 600);
  assert.equal(titles[1].fontWeight, 400);
  assert.equal(titles[1].fontStyle, "italic");
  assert.equal(titles[2].fontWeight, 800);
  assert.equal(titles[2].textTransform, "uppercase");
  assert.ok(new Set(titles.map(style => style.letterSpacing)).size === 3);
});

test("photo overlay strength follows its saved value rather than tinting photo-free panels", () => {
  for (const overlayOpacity of [0, 0.35, 0.8, 1]) {
    const tree = coverHarness().render(coverProps({ overlayOpacity }));
    assert.ok(divWithClass(tree, "event-cover-photo-overlay").props.style.background.includes(`rgba(0,0,0,${overlayOpacity})`));
  }
  const minimal = coverHarness().render(coverProps({ layout: "minimal", overlayOpacity: 0.8 }));
  assert.equal(divWithClass(minimal, "event-cover-photo-overlay"), undefined);
});

test("saved accents appear on the entry button with readable text", () => {
  const luminance = color => {
    let hex = color.replace("#", "");
    if (hex.length === 3) hex = [...hex].map(value => value.repeat(2)).join("");
    const values = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  for (const accentColor of ["#991b1b", "#c4a574", "#f2ede5", "#757575", "#fff"]) {
    const tree = coverHarness().render(coverProps({ accentColor }));
    const button = findAll(tree, "button")[0];
    assert.equal(button.props.style.background, accentColor);
    assert.equal(button.props.style.border, `1px solid ${accentColor}`);
    const values = [luminance(button.props.style.background), luminance(button.props.style.color)].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${accentColor} button text needs contrast`);
  }
  const fallback = coverHarness().render(coverProps());
  assert.equal(findAll(fallback, "button")[0].props.style.background, "#fff");
});

test("embedded owner previews reveal immediately, grow to fit entry controls, and never move focus or schedule global work", () => {
  for (const layout of ["centered", "split", "minimal"]) {
    const ui = coverHarness(), props = coverProps({ preview: true, layout, tone: lightTone });
    const tree = ui.render(props);
    assert.equal(tree.props.style.position, "relative");
    assert.equal(tree.props.style.inset, undefined);
    assert.equal(tree.props.style.zIndex, undefined);
    assert.equal(tree.props.style.minHeight, 520);
    assert.equal(tree.props.style.height, undefined);
    assert.equal(tree.props.style.maxHeight, undefined);
    assert.match(textOf(findAll(tree, "style")[0]), /data-preview="true"[^}]*event-cover-frame[^}]*min-height:\s*520px/);
    assert.equal(tree.props["data-reveal-ready"], true);
    assert.equal(findAll(tree, "h1").length, 0);
    assert.equal(textOf(findAll(tree, "h2")[0]), props.title);
    assert.equal(ui.pendingTimers, 0);
    ui.advance(5000);
    assert.equal(ui.focused, 0);
    findAll(tree, "img")[0].props.onError({ currentTarget: { src: props.imageUrl, isConnected: true, alt: "", dataset: {} } });
    ui.render({ ...props, imageUrl: "/authorized/updated-preview.jpg" });
    assert.equal(ui.pendingTimers, 0);
    ui.unmount();
    assert.equal(ui.focused, 0);
  }
});

test("switching a live cover into an owner preview cancels pending photo and focus work", () => {
  const ui = coverHarness(), props = coverProps();
  findAll(ui.render(props), "img")[0].props.onLoad();
  ui.render(props);
  assert.ok(ui.pendingTimers > 0);
  ui.render({ ...props, preview: true });
  assert.equal(ui.pendingTimers, 0);
  ui.advance(5000);
  assert.equal(ui.focused, 0);
  ui.render({ ...props, preview: false, imageUrl: "/authorized/live-again.jpg" });
  assert.ok(ui.pendingTimers > 0);
  ui.unmount();
  assert.equal(ui.pendingTimers, 0);
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
