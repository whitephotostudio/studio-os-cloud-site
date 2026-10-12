import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { compile as compileTailwind } from "tailwindcss";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("app/dashboard/projects/[id]/settings/page.tsx");
const ast = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props) => typeof type === "function" ? type(props) : { type, props };
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };
function execute(text, globals = {}) {
  const context = { exports: {}, ...globals, require(name) {
    assert.equal(name, "react/jsx-runtime");
    return runtime;
  } };
  vm.runInNewContext(compile(text), context);
  return context;
}
const settings = execute(read("lib/event-gallery-settings.ts")).exports;
const presentation = execute(read("lib/event-gallery-presentation.ts")).exports;
const dates = execute(read("lib/calendar-dates.ts")).exports;
const stateNames = [];
function collectState(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
    && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useState") {
    stateNames.push(node.name.elements[0].getText(ast));
  }
  ts.forEachChild(node, collectState);
}
collectState(ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ProjectSettingsPage"));
const moduleSource = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join("\n");
const nodes = (node, type) => !node || typeof node !== "object" ? []
  : [...(node.type === type ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, type))];
const textOf = node => typeof node === "string" || typeof node === "number" ? String(node)
  : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(textOf).join(" ");
const allNodes = node => !node || typeof node !== "object" ? []
  : [node, ...[node.props?.children].flat(Infinity).flatMap(allNodes)];
function render(section, overrides = {}) {
  const changed = [], values = { loading: false, activeSection: section, projectName: "Fixture client gallery", ...overrides };
  let stateIndex = 0;
  const context = execute(moduleSource, {
    ...settings, ...presentation, ...dates,
    useState(initial) {
      const key = stateNames[stateIndex++];
      const value = key in values ? values[key] : typeof initial === "function" ? initial() : initial;
      return [value, next => changed.push({ key, value: typeof next === "function" ? next(value) : next })];
    },
    useEffect() {}, useMemo: callback => callback(), useRef: value => ({ current: value }),
    createClient: () => ({}), useParams: () => ({ id: "fixture-event" }), useRouter: () => ({ push() {} }),
    EventGalleryCover: "welcome-cover", Link: "a", resolvePackageProfileId() {},
    ...Object.fromEntries(["ArrowLeft", "Check", "ChevronDown", "Download", "FolderOpen", "ImageIcon", "Pencil", "Settings2", "ShieldCheck", "ShoppingCart", "Sparkles"].map(name => [name, "icon"])),
  });
  return { tree: context.exports.default(), changed };
}

function containerColumns(classes, width, container) {
  let columns = 1;
  for (const token of classes.split(/\s+/)) {
    const match = token.match(/^@min-\[(\d+)px\]\/([^:]+):grid-cols-(\d+)$/);
    if (match?.[2] === container && width >= Number(match[1])) columns = Number(match[3]);
  }
  return columns;
}

test("settings rail depends on remaining page width and leaves usable tablet forms", () => {
  const tree = render("general").tree;
  const wrapper = nodes(tree, "div").find(node => node.props.className?.includes("@container/settings-page"));
  const layout = nodes(tree, "div").find(node => node.props.className?.includes("grid-cols-[260px_minmax"));
  assert.ok(wrapper, "The settings page must establish the named inline-size container");
  const query = layout.props.className.match(/@min-\[(\d+)px\]\/settings-page:grid-cols-\[(\d+)px_minmax\(0,1fr\)\]/);
  assert.ok(query, "The rail must be controlled by the page container, not viewport width");
  const breakpoint = Number(query[1]), railWidth = Number(query[2]);
  for (const viewport of [320, 375, 390, 640, 768, 834, 1024, 1280, 1440, 1920]) {
    const dashboardRail = viewport >= 640 ? 220 : 0;
    const pagePadding = viewport >= 1280 ? 64 : viewport >= 640 ? 32 : 24;
    const pageWidth = Math.min(1500, viewport - dashboardRail - pagePadding);
    const mainPadding = viewport >= 1024 ? 48 : viewport >= 640 ? 32 : 24;
    const cardPadding = viewport >= 1024 ? 48 : 32;
    const hasSettingsRail = pageWidth >= breakpoint;
    const cardContent = pageWidth - (hasSettingsRail ? railWidth : 0) - 4 - mainPadding - cardPadding;
    if (viewport <= 1280) assert.equal(hasSettingsRail, false, `${viewport}px keeps settings above its content`);
    assert.ok(cardContent >= (viewport >= 640 ? 300 : 230), `${viewport}px leaves ${cardContent}px for form content`);
  }
});

test("visual choices and form columns use the card width even on wide viewport tablets", () => {
  const tree = render("branding").tree;
  const choices = nodes(tree, "div").filter(node => node.props.className?.includes("@min-[440px]/settings-card:grid-cols-2"));
  assert.equal(choices.length, 3);
  for (const grid of choices) {
    assert.equal(containerColumns(grid.props.className, 288, "settings-card"), 1);
    assert.equal(containerColumns(grid.props.className, 448, "settings-card"), 2);
    assert.equal(containerColumns(grid.props.className, 798, "settings-card"), 3);
  }
  const generalGrid = nodes(render("general").tree, "div").find(node => node.props.className?.includes("@min-[520px]/settings-card:grid-cols-2"));
  assert.equal(containerColumns(generalGrid.props.className, 448, "settings-card"), 1, "A 768px tablet must not compress dates into two narrow columns");
  assert.equal(containerColumns(generalGrid.props.className, 600, "settings-card"), 2);
});

test("all conditionally enabled inputs fit their card and download summaries retain long names", () => {
  const extras = { ...settings.defaultEventGalleryExtras, freeDigitalRuleEnabled: true, freeDigitalAudience: "person",
    freeDigitalTargetEmail: "a-very-long-approved-client-email-address@example.test", showDownloadAllButton: true,
    downloadPinEnabled: true, pickupLocationEnabled: true, allowSocialSharing: true };
  const branding = { ...settings.defaultEventGalleryBranding, marketingBannerEnabled: true };
  for (const section of ["general", "branding", "privacy", "free-digital", "store", "advanced"]) {
    const tree = render(section, { extras, branding, projectAccessMode: "pin" }).tree;
    for (const control of ["input", "select", "textarea"].flatMap(type => nodes(tree, type))) {
      if (control.props.type === "radio") continue;
      assert.match(control.props.className, /\bw-full\b/, `${section} control has an available-width bound`);
      assert.match(control.props.className, /\bmin-w-0\b/, `${section} control can shrink below its native intrinsic width`);
      assert.match(control.props.className, /\bmax-w-(full|md|xs)\b/, `${section} control cannot overrun a narrow card`);
    }
  }
  const summary = nodes(render("free-digital", { extras }).tree, "dl")[0];
  assert.equal(nodes(summary, "dt").length, 4);
  const name = nodes(summary, "dd")[0];
  assert.equal(textOf(name).trim(), extras.freeDigitalTargetEmail);
  assert.match(name.props.className, /break-words/);
});

test("compact navigation keeps every section accessible and toggle targets preserve behavior", () => {
  const { tree, changed } = render("general", { extras: { ...settings.defaultEventGalleryExtras, allowSocialSharing: false } });
  const nav = nodes(tree, "nav")[0], buttons = nodes(nav, "button");
  assert.equal(nav.props["aria-label"], "Project settings");
  assert.equal(buttons.length, 6);
  assert.equal(buttons[0].props["aria-current"], "page");
  for (const button of buttons) {
    assert.match(button.props.className, /min-h-11/);
    button.props.onClick();
  }
  assert.deepEqual(changed.map(change => change.value), ["general", "branding", "privacy", "free-digital", "store", "advanced"]);
  const toggle = nodes(tree, "button").find(button => button.props.role === "switch" && button.props["aria-label"] === "Allow Social Sharing");
  assert.match(toggle.props.className, /min-h-11/);
  assert.equal(toggle.props["aria-checked"], false);
  toggle.props.onClick();
  assert.equal(changed.at(-1).value.allowSocialSharing, true);
});

test("Tailwind emits named container CSS for the actual rendered responsive controls", async () => {
  const candidates = new Set();
  for (const section of ["general", "branding", "privacy", "free-digital", "store", "advanced"]) {
    for (const node of allNodes(render(section).tree)) {
      for (const candidate of (node.props.className || "").split(/\s+/)) if (candidate) candidates.add(candidate);
    }
  }
  const tailwind = await compileTailwind(`${read("node_modules/tailwindcss/theme.css")}\n@tailwind utilities;`);
  const css = tailwind.build([...candidates]);
  assert.match(css, /container-name:\s*settings-page/);
  assert.match(css, /container-name:\s*settings-card/);
  assert.match(css, /@container settings-page \(width >= 1080px\)/);
  assert.match(css, /grid-template-columns:\s*260px minmax\(0,\s*1fr\)/);
  assert.match(css, /@container settings-card \(width >= 440px\)/);
  assert.match(css, /@container settings-card \(width >= 680px\)/);
});


test("project name edit action selects its editable field rather than acting as decoration", () => {
  const branding = render("branding"), edit = nodes(branding.tree, "button").find(node => node.props["aria-label"] === "Edit project name");
  assert.equal(edit.props.type, "button");
  edit.props.onClick();
  assert.deepEqual(branding.changed.map(change => ({ ...change })), [
    { key: "activeSection", value: "general" }, { key: "nameFocusRequested", value: true },
  ]);
  const input = nodes(render("general").tree, "input").find(node => node.props.id === "event-project-name");
  assert.ok(input, "The name action must have a real editable field after switching sections");
  assert.ok(input.props.ref, "The input receives the focus ref used after React commits the section");
});
