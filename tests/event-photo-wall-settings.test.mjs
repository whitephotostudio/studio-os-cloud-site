import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), variables = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer.getText(ast));
  ts.forEachChild(node, collect);
}
collect(ast);

function load(names, globals = {}) {
  const exports = {};
  const constants = ["EVENT_WALL_FALLBACK_ASPECT_RATIO", "MIN_EVENT_WALL_ASPECT_RATIO", "MAX_EVENT_WALL_ASPECT_RATIO"]
    .map(name => `const ${name} = ${variables.get(name)};`).join("\n");
  const compiled = ts.transpileModule(`${constants}\n${names.map(name => functions.get(name)).join("\n")}\nexports.handlers = {${names.join(",")}};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)),
    require: name => {
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      throw new Error(`Unexpected module ${name}`);
    },
    ...globals,
  });
  return exports.handlers;
}

function findAll(node, type) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => findAll(child, type))];
}

const photos = Array.from({ length: 24 }, (_, index) => ({ id: `allowed-${index}`, url: `/authorized/${index}.jpg`, thumbnailUrl: `/authorized/thumb-${index}.jpg` }));
const helpers = load(["getGalleryGap", "getPhotoWallColumnWidth", "getPhotoGridMinWidth"]);

function wall({ layout = "subway", density = "balanced", spacing = "balanced", mobile = false, width = 1300, images = photos } = {}) {
  const branding = { photoLayout: layout, gridDensity: density, imageSpacing: spacing };
  const ref = { current: null };
  const { renderPhotoWall } = load(["getEventWallAspectRatio", "buildEventPhotoRows", "renderPhotoWall"], {
    isSchoolMode: false, activeView: "photos", isMobileViewport: mobile,
    currentGalleryBranding: branding, photoWallStyle: layout,
    galleryGap: helpers.getGalleryGap({ branding }),
    photoWallColumnWidth: helpers.getPhotoWallColumnWidth({ branding }),
    photoGridMinWidth: helpers.getPhotoGridMinWidth({ branding }, mobile),
    eventPhotoWallWidth: width, eventPhotoWallRef: ref,
    galleryImageRatios: Object.fromEntries(photos.map(photo => [photo.id, 1])),
    renderPhotoWallCard: (image, index, options) => ({ type: "photo", props: { image, index, options } }),
  });
  return { tree: renderPhotoWall(images), ref };
}

test("saved wall styles render structured rows, staggered columns, and an editorial lead", () => {
  const subway = wall({ layout: "subway" }), cascade = wall({ layout: "cascade" }), editorial = wall({ layout: "editorial" });
  assert.equal(subway.tree.props.style.display, "grid");
  assert.equal(subway.tree.props.children[0].props.style.display, "flex");
  assert.equal(cascade.tree.props.style.columnWidth, "260px");
  assert.equal(editorial.tree.props.style.display, "grid");
  assert.equal(findAll(editorial.tree, "photo").filter(photo => photo.props.options.featured).length, 1);
  for (const [layout, rendered] of [["subway", subway], ["cascade", cascade], ["editorial", editorial]]) {
    assert.equal(rendered.tree.props.ref, rendered.ref);
    const renderedPhotos = findAll(rendered.tree, "photo");
    assert.deepEqual(renderedPhotos.map(photo => photo.props.image.id), photos.map(photo => photo.id));
    assert.ok(renderedPhotos.every(photo => photo.props.options.layout === layout));
  }
});

test("each wall style honors airy, balanced, and tight image spacing", () => {
  for (const mobile of [false, true]) for (const layout of ["subway", "cascade", "editorial"]) {
    const gaps = ["airy", "balanced", "tight"].map(spacing => {
      const { tree } = wall({ layout, spacing, mobile });
      const gap = layout === "editorial" ? tree.props.children[0].props.style.gap : tree.props.style.columnGap ?? tree.props.style.gap;
      return Number.parseFloat(gap);
    });
    assert.deepEqual(gaps, [12, 8, 4], `${layout}, mobile=${mobile}`);
  }
});

test("subway spacing and row calculations agree, keeping justified rows within their measured width", () => {
  for (const spacing of ["airy", "balanced", "tight"]) {
    const { tree } = wall({ spacing, width: 1300 });
    const row = tree.props.children[0];
    const items = row.props.children;
    const gap = Number.parseFloat(row.props.style.gap);
    const renderedWidth = items.reduce((sum, item) => sum + Number.parseFloat(item.props.style.width), 0) + gap * (items.length - 1);
    assert.ok(Math.abs(renderedWidth - 1300) <= items.length, `${spacing}: ${renderedWidth}`);
  }
});

test("phone density changes the actual columns for every photo wall style", () => {
  for (const layout of ["subway", "cascade", "editorial"]) {
    const columns = ["airy", "balanced", "tight"].map(density => {
      const { tree } = wall({ layout, density, mobile: true });
      if (layout === "cascade") return tree.props.style.columnCount;
      const grid = layout === "editorial" ? tree.props.children[0].props.children[1] : tree;
      return Number(grid.props.style.gridTemplateColumns.match(/repeat\((\d+)/)[1]);
    });
    assert.deepEqual(columns, [1, 2, 3], layout);
  }
});

test("desktop density changes structured row composition and staggered column width", () => {
  const rows = ["airy", "balanced", "tight"].map(density => wall({ density }).tree.props.children[0].props.children.length);
  assert.ok(rows[0] < rows[1] && rows[1] < rows[2], JSON.stringify(rows));
  const widths = ["airy", "balanced", "tight"].map(density => wall({ layout: "cascade", density }).tree.props.style.columnWidth);
  assert.deepEqual(widths, ["320px", "260px", "210px"]);
});

test("empty galleries and current event batches keep only the supplied authorized photos", () => {
  for (const layout of ["subway", "cascade", "editorial"]) {
    assert.equal(findAll(wall({ layout, images: [] }).tree, "photo").length, 0);
    const rendered = findAll(wall({ layout, images: photos.slice(0, 6) }).tree, "photo");
    assert.deepEqual(rendered.map(photo => photo.props.image.id), photos.slice(0, 6).map(photo => photo.id));
  }
});

function card({ mobile = false, density = "balanced", audience = "album", selectedAlbum = null, share = true, index = 18 } = {}) {
  const actions = [];
  const image = photos[index];
  const { renderPhotoWallCard } = load(["getEventWallAspectRatio", "getSafeAspectRatio", "renderPhotoWallCard"], {
    photoWallStyle: "cascade", favorites: new Set(), isSchoolMode: false, activeView: "photos", isMobileViewport: mobile,
    currentGalleryBranding: { gridDensity: density }, currentGalleryExtras: { allowSocialSharing: share },
    galleryTone: { surface: "#111", border: "#333", text: "#eee" }, isLightGallery: false,
    buildGalleryImageCandidates: photo => [photo.thumbnailUrl, photo.url], getPhotoReference: i => ({ number: `Photo ${i + 1}`, name: "" }),
    loadedGalleryImageIds: new Set([image.id]), galleryImageRatios: { [image.id]: 0.75 },
    galleryDownloadAccess: { enabled: true, audience }, activeEventCollectionId: selectedAlbum,
    openImageInGallery: photo => actions.push(["open", photo.id]), toggleFavorite: id => actions.push(["favorite", id]),
    downloadSingleImage: photo => actions.push(["download", photo.id]), handleShareImage: photo => actions.push(["share", photo.id]),
    handleGalleryImageError: () => {}, markGalleryImageLoaded: () => {}, galleryImageFilter: undefined,
    showProofWatermark: false, LoaderCircle: "loader", Heart: "heart", Download: "download", Share2: "share",
  });
  return { tree: renderPhotoWallCard(image, index, { layout: "cascade" }), actions, image };
}

test("phone density keeps lazy image sources and album download guards while fitting action controls", () => {
  const blocked = card({ mobile: true, density: "tight" });
  const buttons = findAll(blocked.tree, "button");
  assert.deepEqual(buttons.map(button => button.props["aria-label"]), ["Add favorite", "Share photo"]);
  assert.ok(buttons.every(button => button.props.style.width >= 24 && button.props.style.width <= 32));
  const image = findAll(blocked.tree, "img")[0];
  assert.equal(image.props.src, blocked.image.thumbnailUrl);
  assert.equal(image.props.loading, "lazy");
  const allowed = card({ mobile: true, density: "tight", selectedAlbum: "authorized-album" });
  const download = findAll(allowed.tree, "button").find(button => button.props["aria-label"] === "Download photo");
  let stopped = 0;
  download.props.onClick({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  assert.deepEqual(allowed.actions, [["download", allowed.image.id]]);
  allowed.tree.props.onClick();
  assert.deepEqual(allowed.actions[1], ["open", allowed.image.id]);
});
