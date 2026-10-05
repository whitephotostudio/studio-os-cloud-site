import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const load = (path, globals = {}) => {
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL(path, import.meta.url), "utf8")), { exports, ...globals });
  return exports;
};
const helpers = load("../lib/event-album-navigation.ts");
const mediaHelpers = load("../lib/event-gallery-media-client.ts", { URL, atob, TextDecoder, Uint8Array });
const plain = value => JSON.parse(JSON.stringify(value));
const collections = [
  { id: "terry", title: "Terry" },
  { id: "web", title: "Web" },
  { id: "kite", title: "Kite 2026" },
  { id: "kite-web", title: "Kite web-size" },
];
const images = collections.flatMap((collection, index) => [
  { id: `${collection.id}-1`, collectionId: collection.id, url: `/photos/${index}.jpg`, thumbnailUrl: `/thumbs/${index}.jpg` },
  { id: `${collection.id}-2`, collectionId: collection.id, url: `/photos/${index}-2.jpg` },
]);
const choicesFor = (overrides = {}) => helpers.buildEventAlbumChoices({
  collections, images, hideAllPhotosAlbum: false, allPhotosTitle: "All Photos", albumTitle: "Album", ...overrides,
});

test("all four accessible albums and All Photos appear without a featured-album cap", () => {
  const choices = choicesFor();
  assert.deepEqual(plain(choices.map(choice => choice.title)), ["All Photos", "Terry", "Web", "Kite 2026", "Kite web-size"]);
  assert.deepEqual(plain(choices.map(choice => choice.photoCount)), [8, 2, 2, 2, 2]);
  assert.equal(choices[4].thumbnailUrl, "/thumbs/3.jpg");
  assert.deepEqual(plain(helpers.initialEventAlbumSelection(choices)), { collectionId: null, stage: "albums" });
});

test("hidden All Photos stays unavailable; valid album PIN entry stays scoped", () => {
  const scoped = choicesFor({ collections: [collections[3]], hideAllPhotosAlbum: true });
  assert.deepEqual(plain(scoped.map(choice => choice.value)), ["album:kite-web"]);
  assert.equal(scoped[0].photoCount, 2);
  assert.equal(helpers.eventAlbumChoiceForValue(scoped, "__all__"), null);
  assert.equal(helpers.eventAlbumChoiceForValue(scoped, "album:terry"), null);
  assert.deepEqual(plain(helpers.initialEventAlbumSelection(scoped, "kite-web")), { collectionId: "kite-web", stage: "grid" });
  assert.deepEqual(plain(helpers.initialEventAlbumSelection(scoped, "terry")), { collectionId: null, stage: "albums" });
});

test("media outside the authorized context collections never contributes to All Photos", () => {
  const scoped = helpers.accessibleEventGalleryImages(images, [collections[0]]);
  assert.deepEqual(plain(scoped.map(image => image.id)), ["terry-1", "terry-2"]);
  const choices = choicesFor({ collections: [collections[0]], images: [...images, { id: "private", collectionId: "private", url: "/private.jpg" }] });
  assert.equal(choices[0].photoCount, 2);
  assert.equal(choices.length, 2);
  assert.equal(helpers.eventAlbumChoiceForValue(choices, "album:private"), null);
});

test("empty authorized albums remain choices and unknown/duplicate IDs do not create extra choices", () => {
  const choices = choicesFor({ collections: [...collections, { id: "empty", title: "Coming soon" }, collections[0], { id: "", title: "Invalid" }] });
  assert.equal(choices.length, 6);
  assert.equal(choices[5].photoCount, 0);
  assert.equal(choices[5].thumbnailUrl, null);
  assert.deepEqual(plain(helpers.initialEventAlbumSelection(choices, "empty")), { collectionId: "empty", stage: "grid" });
  assert.deepEqual(plain(helpers.initialEventAlbumSelection([])), { collectionId: null, stage: "grid" });
});

function findAll(node, type) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => findAll(child, type))];
}
function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return [node.props?.children].flat(Infinity).map(textOf).join(" ");
}
function componentHarness() {
  const hooks = [], listeners = new Map();
  let cursor = 0;
  const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
  const react = {
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((dep, i) => dep !== hooks[index].deps[i])) {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: fn() };
      }
    },
  };
  const components = load("../components/parents/event-album-navigation.tsx", {
    document: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    require: name => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return new Proxy({}, { get: (_, key) => `icon-${String(key)}` });
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return { components, hooks, listeners, render(name, props) { cursor = 0; return components[name](props); } };
}
const componentProps = onSelect => ({ choices: choicesFor(), onSelect, hidePhotoCount: false, photoLabel: "photo", photosLabel: "photos" });

test("mobile and desktop overview renders every thumbnail choice before any photo grid", () => {
  for (const isMobile of [true, false]) {
    const ui = componentHarness(), selected = [];
    const tree = ui.render("EventAlbumOverview", {
      ...componentProps(value => selected.push(value)), isMobile,
      title: "A branded gallery", description: "Choose an album, or view all photos.", albumsLabel: "Albums",
      brandName: "White Photo", brandLogoUrl: "/logo.svg", metadata: ["4 albums", "8 photos"],
      tone: { background: "#fafafa", surface: "#fff", text: "#111", mutedText: "#555", border: "#ddd" },
    });
    const buttons = findAll(tree, "button");
    assert.equal(buttons.length, 5);
    assert.equal(findAll(tree, "img").length, 6);
    assert.equal(tree.props.style.overflow, "auto");
    assert.equal(tree.props.style.minHeight, 0);
    assert.match(textOf(tree), /White Photo/);
    assert.match(textOf(tree), /Kite web-size/);
    buttons[4].props.onClick();
    assert.deepEqual(selected, ["album:kite-web"]);
  }
});

test("thumbnail dropdown exposes current selection/count and all choices", () => {
  const ui = componentHarness();
  const tree = ui.render("EventAlbumSwitcher", { ...componentProps(() => {}), value: "album:kite-web", label: "Browse Gallery" });
  const summary = findAll(tree, "summary")[0];
  assert.equal(summary.props["aria-label"], "Browse Gallery: Kite web-size");
  assert.match(textOf(summary), /2 photos/);
  assert.equal(findAll(tree, "img").length, 6);
  const current = findAll(tree, "button").filter(button => button.props["aria-current"] === "true");
  assert.equal(current.length, 1);
  assert.match(textOf(current[0]), /Kite web-size/);
  assert.equal(findAll(tree, "nav")[0].props["aria-label"], "Browse Gallery");
});

test("dropdown selection and Escape close it and return keyboard focus; outside click closes it", () => {
  const ui = componentHarness(), selected = [];
  const tree = ui.render("EventAlbumSwitcher", { ...componentProps(value => selected.push(value)), value: "__all__", label: "Browse Gallery" });
  let focus = 0, prevented = 0;
  const inside = {};
  ui.hooks[0].current = { open: true, contains: target => target === inside };
  ui.hooks[1].current = { focus: () => focus++ };
  findAll(tree, "button")[4].props.onClick();
  assert.deepEqual(selected, ["album:kite-web"]);
  assert.equal(ui.hooks[0].current.open, false);
  assert.equal(focus, 1);
  ui.hooks[0].current.open = true;
  tree.props.onKeyDown({ key: "Escape", preventDefault: () => prevented++ });
  assert.equal(ui.hooks[0].current.open, false);
  assert.equal(focus, 2);
  assert.equal(prevented, 1);
  ui.hooks[0].current.open = true;
  ui.listeners.get("pointerdown")({ target: inside });
  assert.equal(ui.hooks[0].current.open, true);
  ui.listeners.get("pointerdown")({ target: {} });
  assert.equal(ui.hooks[0].current.open, false);
  const nextTree = ui.render("EventAlbumSwitcher", { ...componentProps(() => {}), value: "album:kite-web", label: "Browse Gallery" });
  assert.match(textOf(findAll(nextTree, "summary")[0]), /Kite web-size/);
});

test("owner-hidden photo counts stay absent from the dropdown", () => {
  const ui = componentHarness();
  const tree = ui.render("EventAlbumSwitcher", { ...componentProps(() => {}), value: "__all__", label: "Browse Gallery", hidePhotoCount: true });
  assert.doesNotMatch(textOf(tree), /8 photos|2 photos/);
});

const pageSource = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), variables = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(pageAst));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variables.set(node.name.text, node.getText(pageAst));
  ts.forEachChild(node, collect);
}
collect(pageAst);

function pageHarness(overrides = {}) {
  const requests = [], state = [], notices = [], deliveries = [], routes = [];
  const sandbox = {
    exports: {}, ...helpers, ...mediaHelpers,
    clean: value => (value ?? "").trim(),
    images, visibleImages: images, visibleDownloadImages: images,
    eventAlbumChoices: choicesFor(), eventHasAlbums: true, eventPhotoGridInitialLimit: 60,
    isSchoolMode: false, activeEventCollectionId: null, showAlbumOverview: false,
    downloadingGallery: false, downloadingFavorites: false, favoriteImages: [],
    currentGalleryExtras: { hideAllPhotosAlbum: false, watermarkDownloads: false, includePrintRelease: false, freeDigitalResolution: "original" },
    galleryDownloadAccess: { enabled: true, canDownload: true, audience: "gallery", requiresPin: false, resolution: "original", downloadsUsed: 0, downloadsRemaining: null },
    favoriteDownloadAccess: { canDownload: true },
    galleryCopy: { allPhotos: "All Photos", downloadAlbum: "Download Album", downloadAllPhotos: "Download All Photos", downloadAll: "Download All", openAlbumToDownload: "Open an album first" },
    projectId: "project", eventEmail: "client@example.test", pin: "authorized-pin",
    window: { location: { pathname: "/parents/authorized-pin", search: "?projectId=project" }, setTimeout: () => 1, prompt: () => "download-pin" },
    getGalleryActionErrorMessage: (error, fallback) => error.message || fallback,
    showGalleryActionNotice: message => notices.push(message),
    getPhotoReference: () => ({ number: "Photo 001" }),
    deviceSupportsPhotoShare: () => false,
    writeEventGalleryDownloadManifest: () => true,
    router: { push: path => routes.push(path) },
    downloadImagesBatch: async selected => { deliveries.push(selected.map(image => image.id)); return { archivedPhotoCount: selected.length, failedFileNames: [], deliveredVia: "zip" }; },
    shareGalleryImagesToPhotos: async selected => { deliveries.push(selected.map(image => image.id)); return { archivedPhotoCount: selected.length, failedFileNames: [], cancelled: false }; },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return { ok: true, json: async () => ({ ok: true, allowedMediaIds: body.mediaIds, deliveries: body.mediaIds.map(mediaId => ({mediaId,url:"/api/portal/event-download-file?token=fixture",watermarked:false,resolution:"original"})), downloadsRemaining: null, manifest: { id: "fixture", photoCount: body.mediaIds.length, downloadsRemaining: null } }) };
    },
    ...overrides,
  };
  for (const name of ["ActiveEventCollectionId", "SelectedImageIndex", "EventPhotoGridLimit", "EventPhotoStage", "ActiveView", "DownloadingGallery", "GalleryDownloadProgress", "DownloadingFavorites", "FavoriteMessage"]) {
    sandbox[`set${name}`] = value => state.push({ name, value });
  }
  sandbox.setGalleryDownloadAccess = update => { sandbox.galleryDownloadAccess = update(sandbox.galleryDownloadAccess); };
  const names = ["openEventPhotoGrid", "openAlbumsOverview", "handleGalleryPickerChange", "openImageInGallery", "focusImageForActions", "downloadGalleryImages", "downloadFavoriteImages", "downloadSingleImage"];
  vm.runInNewContext(compile(`${names.map(name => functions.get(name)).join("\n")}\nexports.handlers = {${names.join(",")}};`), sandbox);
  return { handlers: sandbox.exports.handlers, requests, state, notices, deliveries, routes, sandbox };
}

test("actual gallery picker handlers open the fourth album and reject inaccessible or hidden choices", () => {
  const page = pageHarness();
  page.handlers.handleGalleryPickerChange("album:kite-web");
  assert.deepEqual(plain(page.state), [
    { name: "ActiveEventCollectionId", value: "kite-web" }, { name: "SelectedImageIndex", value: 0 },
    { name: "EventPhotoGridLimit", value: 60 }, { name: "EventPhotoStage", value: "grid" }, { name: "ActiveView", value: "photos" },
  ]);
  const denied = pageHarness({ eventAlbumChoices: choicesFor({ hideAllPhotosAlbum: true }), currentGalleryExtras: { hideAllPhotosAlbum: true } });
  denied.handlers.handleGalleryPickerChange("__all__");
  denied.handlers.handleGalleryPickerChange("album:private");
  assert.equal(denied.state.length, 0);
});

test("opening a photo preserves All Photos; a selected album rejects an out-of-scope photo", () => {
  const all = pageHarness();
  all.handlers.openImageInGallery(images[6]);
  assert.equal(all.state.find(write => write.name === "SelectedImageIndex").value, 6);
  assert.equal(all.state.some(write => write.name === "ActiveEventCollectionId"), false);
  const scoped = pageHarness({ activeEventCollectionId: "terry" });
  scoped.handlers.openImageInGallery(images[6]);
  assert.equal(scoped.handlers.focusImageForActions(images[6]), false);
  assert.equal(scoped.state.length, 0);
});

test("actual album ready/share download requests remain scoped even with a gallery-wide free rule", async () => {
  for (const share of [false, true]) {
    const selected = helpers.imagesInEventAlbum(images, "kite-web");
    const page = pageHarness({ activeEventCollectionId: "kite-web", visibleDownloadImages: selected, deviceSupportsPhotoShare: () => share });
    await page.handlers.downloadGalleryImages();
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].url, share ? "/api/portal/event-downloads" : "/api/portal/event-download-ready");
    assert.equal(page.requests[0].body.collectionId, "kite-web");
    assert.deepEqual(plain(page.requests[0].body.mediaIds), ["kite-web-1", "kite-web-2"]);
    assert.equal(page.notices.some(message => message.includes("Could not")), false);
  }
});

test("actual All Photos and single-photo requests communicate the selected scope", async () => {
  const all = pageHarness();
  await all.handlers.downloadGalleryImages();
  assert.equal(all.requests[0].body.collectionId, null);
  assert.equal(all.requests[0].body.mediaIds.length, 8);
  const album = pageHarness({ activeEventCollectionId: "kite-web" });
  await album.handlers.downloadSingleImage(images[6], 0);
  assert.equal(album.requests[0].body.collectionId, "kite-web");
  assert.deepEqual(plain(album.requests[0].body.mediaIds), ["kite-web-1"]);
});

test("favorite selection and download use only the selected album without clearing saved favorites", async () => {
  const favorites = new Set(images.map(image => image.id));
  const exports = {};
  vm.runInNewContext(compile(`const ${variables.get("favoriteImages")}; exports.images = favoriteImages;`), {
    exports, useMemo: fn => fn(), images, favorites, isSchoolMode: false, activeEventCollectionId: "kite-web", imagesInEventAlbum: helpers.imagesInEventAlbum,
  });
  assert.deepEqual(plain(exports.images.map(image => image.id)), ["kite-web-1", "kite-web-2"]);
  assert.equal(favorites.size, 8);
  const page = pageHarness({ activeEventCollectionId: "kite-web", favoriteImages: exports.images });
  await page.handlers.downloadFavoriteImages();
  assert.equal(page.requests[0].body.collectionId, "kite-web");
  assert.deepEqual(plain(page.requests[0].body.mediaIds), ["kite-web-1", "kite-web-2"]);
  assert.deepEqual(plain(page.deliveries), [["kite-web-1", "kite-web-2"]]);
});

test("overview, disabled/locked downloads and album-only rules still block requests", async () => {
  for (const overrides of [
    { showAlbumOverview: true },
    { galleryDownloadAccess: { enabled: false } },
    { galleryDownloadAccess: { enabled: true, audience: "gallery", canDownload: false } },
    { galleryDownloadAccess: { enabled: true, audience: "album", canDownload: true } },
    { galleryDownloadAccess: { enabled: true, audience: "gallery", canDownload: true, requiresPin: true, hasPinConfigured: false } },
  ]) {
    const page = pageHarness(overrides);
    await page.handlers.downloadGalleryImages();
    assert.equal(page.requests.length, 0);
    assert.equal(page.notices.length, 1);
  }
  const paidFavorites = pageHarness({ favoriteImages: images, favoriteDownloadAccess: { canDownload: false } });
  await paidFavorites.handlers.downloadFavoriteImages();
  assert.equal(paidFavorites.requests.length, 0);
});

test("actual button label follows All Photos/album while school labels stay unchanged", () => {
  for (const [isSchoolMode, activeEventCollectionId, expected] of [[false, null, "Download All Photos"], [false, "kite-web", "Download Album"], [true, null, "Download All"]]) {
    const exports = {};
    vm.runInNewContext(compile(`const ${variables.get("galleryDownloadButtonLabel")}; exports.label = galleryDownloadButtonLabel;`), {
      exports, isSchoolMode, activeEventCollectionId, galleryCopy: pageHarness().sandbox.galleryCopy,
    });
    assert.equal(exports.label, expected);
  }
});
