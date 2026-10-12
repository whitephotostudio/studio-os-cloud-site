import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../components/parents/parent-gallery-client.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(parsed.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node.getText(parsed)]));
const compile = name => ts.transpileModule(`${functions.get(name)}\nreturn ${name};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const image = (id, width = 600, height = 900) => ({ id, naturalWidth: width, naturalHeight: height });

function fixture(name = "CompositeCanvas") {
  const cache = new Map(), pending = new Map(), requests = [], draws = [], states = [], refs = [];
  let stateIndex = 0, refIndex = 0, effects = [], passiveEffects = [], intersection;
  const makeCanvas = () => {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({
      scale() {}, clearRect() {}, setTransform() {},
      drawImage(...args) { draws.push({ canvas, args }); },
    });
    return canvas;
  };
  const useState = initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
  };
  const environment = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useRef: () => { const index = refIndex++; return refs[index] ||= { current: makeCanvas() }; },
    useState,
    useEffect: effect => passiveEffects.push(effect),
    useLayoutEffect: effect => effects.push(effect),
    window: { devicePixelRatio: 2 },
    document: { createElement: makeCanvas },
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe() {} disconnect() {}
    },
    cachedGalleryImage: src => cache.get(src) || null,
    galleryThumbnailUrl: src => `${src}&size=thumbnail`,
    loadGalleryImage: (src, priority) => {
      requests.push({ src, priority });
      if (cache.has(src)) return Promise.resolve(cache.get(src));
      if (!pending.has(src)) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        pending.set(src, { promise, resolve: value => { cache.set(src, value); resolve(value); }, reject: error => { pending.delete(src); reject(error); } });
      }
      return pending.get(src).promise;
    },
    getEffectiveBackdropBlurPx: value => value || 0,
    clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)),
    WatermarkOverlay() {},
  };
  const component = new Function(...Object.keys(environment), compile(name))(...Object.values(environment));
  const props = { backdropUrl: "/backdrop.jpg", nobgUrl: "/cutout-A?token=a", fallbackUrl: "/original-A.jpg", width: 600, height: 800, preserveForegroundAlignment: true };
  const render = (overrides = {}) => {
    stateIndex = 0; refIndex = 0; effects = []; passiveEffects = [];
    const tree = component({ ...props, ...overrides });
    return { tree, start: () => effects.map(effect => effect()), observe: () => passiveEffects.map(effect => effect()) };
  };
  return { cache, pending, requests, draws, states, refs, render, intersect: () => intersection([{ isIntersecting: true }]) };
}

const foregroundDraws = h => h.draws.filter(call => String(call.args[0]?.id || "").startsWith("pose"));

test("current cached thumbnail paints synchronously and upgrades without waiting to start full preview", async () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background", 1000, 1600));
  h.cache.set("/cutout-A?token=a&size=thumbnail", image("pose-A-thumb", 267, 400));
  h.render().start();
  assert.equal(foregroundDraws(h)[0].args[0].id, "pose-A-thumb");
  assert.equal(h.render().tree.props["data-preview-state"], "thumbnail");
  assert.ok(h.pending.has("/cutout-A?token=a"), "full preview starts before thumbnail completion");
  h.pending.get("/cutout-A?token=a").resolve(image("pose-A-full"));
  await flush();
  assert.equal(foregroundDraws(h).at(-1).args[0].id, "pose-A-full");
  assert.equal(h.render().tree.props["data-preview-state"], "full");
  assert.equal(h.requests.some(request => request.src === "/original-A.jpg"), false, "chroma original never flashes through");
});

test("navigation hides the old pose immediately and canceled slow loads cannot paint it later", async () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  const [cancelA] = h.render().start();
  cancelA();
  const next = { nobgUrl: "/cutout-B?token=b", fallbackUrl: "/original-B.jpg" };
  assert.equal(h.render(next).tree.props["data-preview-state"], "loading");
  h.render(next).start();
  h.pending.get("/cutout-B?token=b").resolve(image("pose-B-full"));
  await flush();
  h.pending.get("/cutout-A?token=a").resolve(image("pose-A-late"));
  h.pending.get("/cutout-A?token=a&size=thumbnail").resolve(image("pose-A-thumb-late"));
  await flush();
  assert.deepEqual(foregroundDraws(h).map(call => call.args[0].id), ["pose-B-full"]);
  assert.equal(h.render(next).tree.props["data-preview-state"], "full");
});

test("same-photo backdrop edits retain its valid frame; a different photo does not", async () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  h.cache.set("/cutout-A?token=a", image("pose-A-full"));
  h.render().start();
  assert.equal(h.render({ backdropUrl: "/new-backdrop.jpg" }).tree.props["data-preview-state"], "full");
  assert.equal(h.render({ nobgUrl: "/cutout-B?token=b" }).tree.props["data-preview-state"], "loading");
  assert.equal(h.requests.length, 0, "retained full preview needs no further request");
});

test("Safari CSS blur uses separate canvases and preserves portrait contain geometry", () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background", 1000, 1500));
  h.cache.set("/cutout-A?token=a", image("pose-A-full", 600, 900));
  const result = h.render({ backdropBlurPx: 12, foregroundScale: 1.1, foregroundVerticalOffset: 0.15 });
  result.start();
  const foreground = foregroundDraws(h)[0];
  assert.equal(foreground.args.length, 5);
  assert.equal(foreground.args[2], 0, "portrait ignores landscape vertical offset");
  assert.equal(foreground.args[4], 800);
  assert.ok(Math.abs(foreground.args[3] - 800 * 600 / 900) < 0.001);
  assert.ok(h.draws.some(call => call.canvas === h.refs[1].current), "backdrop layer receives its own bitmap");
  assert.ok(h.draws.some(call => call.canvas === h.refs[2].current), "foreground layer receives its own bitmap");
  assert.equal(h.requests.length, 0, "blur mode reuses decoded images");
});

test("landscape CSS blur retains foreground scale and CSS percentage offset", () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  h.cache.set("/cutout-A?token=a", image("pose-A-full", 600, 900));
  h.render({ width: 1067, height: 800, backdropBlurPx: 12, preserveForegroundAlignment: false, foregroundScale: 1.06, foregroundVerticalOffset: 0.05 }).start();
  const args = foregroundDraws(h)[0].args;
  assert.equal(args[4], 848);
  assert.ok(Math.abs(args[2] - ((800 - 848) / 2 + 800 * 0.05 * 1.06)) < 0.001);
});

test("failed foreground leaves an explicit current-photo state and never fetches a chroma original", async () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  h.render().start();
  h.pending.get("/cutout-A?token=a").reject(new Error("Unavailable"));
  h.pending.get("/cutout-A?token=a&size=thumbnail").reject(new Error("Unavailable"));
  await flush();
  assert.ok(h.states[1]);
  assert.equal(h.render().tree.props["data-preview-state"], "loading");
  assert.equal(h.requests.some(request => request.src === "/original-A.jpg"), false);
  const findButton = node => {
    if (node?.type === "button") return node;
    return node?.children?.flat(Infinity).map(findButton).find(Boolean);
  };
  const retry = findButton(h.render().tree);
  assert.ok(retry, "terminal failure offers an actual retry");
  retry.props.onClick();
  h.render().start();
  assert.ok(h.pending.has("/cutout-A?token=a"), "retry starts a fresh current-photo request");
});

test("offscreen strip waits for visibility and loads only small cutout source", async () => {
  const h = fixture("MiniComposite");
  const initial = h.render(); initial.observe(); initial.start();
  assert.equal(h.requests.length, 0);
  h.intersect();
  h.render().start();
  assert.ok(h.requests.some(request => request.src === "/cutout-A?token=a&size=thumbnail"));
  assert.equal(h.requests.some(request => request.src === "/cutout-A?token=a"), false);
  assert.ok(h.requests.every(request => request.priority === "low"));
});


test("retina viewer canvas stays within the bounded preview bitmap budget", () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  h.cache.set("/cutout-A?token=a", image("pose-A-full"));
  h.render({ width: 850, height: 1280 }).start();
  assert.equal(h.refs[0].current.height, 1800);
  assert.ok(h.refs[0].current.width <= 1800);
});


test("blur toggle after cache expiry cannot reveal an undrawn replacement canvas", () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  h.cache.set("/cutout-A?token=a", image("pose-A-full"));
  h.render().start();
  assert.equal(h.render().tree.props["data-preview-state"], "full");
  h.cache.clear();
  const blurred = h.render({ backdropBlurPx: 12 });
  assert.equal(blurred.tree.props["data-preview-state"], "loading");
  blurred.start();
  assert.ok(h.pending.has("/cutout-A?token=a"));
  assert.ok(h.pending.has("/backdrop.jpg"));
});

test("blur layer contains the portrait in a width-clamped narrow wrapper", () => {
  const h = fixture();
  const tree = h.render({ backdropBlurPx: 12, responsive: true }).tree;
  const findCanvas = node => node?.type === "canvas" && node.props.ref === h.refs[2]
    ? node
    : node?.children?.flat(Infinity).map(findCanvas).find(Boolean);
  const foreground = findCanvas(tree);
  assert.equal(foreground.props.style.objectFit, "contain");
  assert.equal(tree.props.style.maxWidth, "100%");
});


test("rapid canvas to blur to canvas after cache expiry retains the original painted DOM canvas", () => {
  const h = fixture();
  h.cache.set("/backdrop.jpg", image("background"));
  h.cache.set("/cutout-A?token=a", image("pose-A-full"));
  const canvases = node => node && typeof node === "object"
    ? [...(node.type === "canvas" ? [node] : []), ...(node.children || []).flat(Infinity).flatMap(canvases)]
    : [];
  const initial = h.render();
  initial.start();
  assert.equal(canvases(initial.tree).length, 3, "both branches stay mounted from the first render");
  const originalCanvas = h.refs[0].current;
  assert.ok(originalCanvas.width > 0);
  h.cache.clear();
  const blurred = h.render({ backdropBlurPx: 12 });
  const [cancelBlur] = blurred.start();
  assert.equal(canvases(blurred.tree).length, 3);
  cancelBlur();
  const returned = h.render();
  assert.equal(returned.tree.props["data-preview-state"], "full");
  const visibleCanvas = canvases(returned.tree).find(node => node.props.ref === h.refs[0]);
  assert.equal(visibleCanvas.props.style.display, "block");
  assert.equal(visibleCanvas.props.style.opacity, 1);
  assert.equal(h.refs[0].current, originalCanvas);
  assert.ok(originalCanvas.width > 0, "returning to the original branch preserves its existing bitmap");
});
