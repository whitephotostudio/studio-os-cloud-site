import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../components/studio-os-download-access.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const jsx = (type, props) => ({ type, props });
const validStatus = {
  ok: true,
  signedIn: true,
  userEmail: "photographer@example.test",
  entitlement: { canDownload: true, appAccessEnabled: true, planCode: "studio" },
};
const successfulStatus = () => Response.json(validStatus);
const settle = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

function findAll(node, type) {
  if (!node || typeof node !== "object") return [];
  return [
    ...(node.type === type ? [node] : []),
    ...[node.props?.children].flat(Infinity).flatMap(child => findAll(child, type)),
  ];
}
function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return [node.props?.children].flat(Infinity).map(textOf).join(" ");
}
const button = (tree, label) => findAll(tree, "button").find(node => textOf(node).includes(label));
const downloads = tree => findAll(tree, "a").filter(node => node.props.href.startsWith("/api/studio-os-app/download"));

function harness(fetcher, props = { publicRelease: true, macReady: true, windowsReady: false }) {
  const hooks = [];
  const timers = new Map();
  let cursor = 0;
  let pendingEffects = [];
  let signOutCalls = 0;
  let stateWrites = 0;
  let nextTimer = 0;
  const session = { auth: { signOut: async () => { signOutCalls++; } } };
  const window = {
    location: { search: "", href: "/studio-os/download" },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const memo = (fn, deps) => {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
      hooks[index] = { value: fn(), deps };
    }
    return hooks[index].value;
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, value => {
        stateWrites++;
        hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
    },
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          hooks[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const exports = {};
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "next/link": { default: "Link" },
    "lucide-react": new Proxy({}, { get: (_, key) => `icon-${String(key)}` }),
    "@/components/reveal": { Reveal: "Reveal" },
    "@/lib/supabase/client": { createClient: () => session },
    "@/lib/trial-config": { FREE_TRIAL_DAYS: 30 },
  };
  vm.runInNewContext(compiled, {
    exports, window, fetch: fetcher, URLSearchParams, AbortController, AbortSignal,
    require: name => { assert.ok(name in modules, `Unexpected module ${name}`); return modules[name]; },
  });
  return {
    render() {
      cursor = 0;
      const tree = exports.StudioOSDownloadAccess(props);
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach(fn => fn());
      return tree;
    },
    unmount() { hooks.forEach(hook => hook.cleanup?.()); },
    expireTimeout() {
      const pending = [...timers.values()];
      assert.equal(pending.length, 1);
      assert.equal(pending[0].delay, 15000);
      pending[0].fn();
    },
    get signOutCalls() { return signOutCalls; },
    get stateWrites() { return stateWrites; },
    get timerCount() { return timers.size; },
    window,
  };
}

test("status failures preserve auth and show retry without signup or download", async () => {
  const failures = [
    () => Response.json({ ok: false, signedIn: true }, { status: 500 }),
    () => Response.json({ ok: false, signedIn: false }, { status: 429 }),
    () => Response.json({ ok: false, signedIn: false }, { status: 403 }),
    () => new Response("broken JSON", { status: 200 }),
    () => Response.json({ ok: true, signedIn: true }),
    () => Response.json({ ok: true, signedIn: true, entitlement: { canDownload: "yes" } }),
    () => Response.json({ ok: true, signedIn: false }),
    () => new Response("broken JSON", { status: 401 }),
    () => Response.json({ ok: false, signedIn: true }, { status: 401 }),
    () => { throw new Error("offline"); },
  ];
  for (const failure of failures) {
    const ui = harness(async (url, options) => {
      assert.equal(url, "/api/studio-os-app/status");
      assert.equal(options.credentials, "include");
      assert.ok(options.signal);
      return failure();
    });
    ui.render();
    await settle();
    const tree = ui.render();
    assert.equal(ui.signOutCalls, 0);
    assert.equal(findAll(tree, "div").filter(node => node.props.role === "alert").length, 1);
    assert.ok(button(tree, "Retry access check"));
    assert.equal(button(tree, "Start Free"), undefined);
    assert.equal(button(tree, "Activate Trial"), undefined);
    assert.equal(downloads(tree).length, 0);
    assert.equal(ui.timerCount, 0);
    ui.unmount();
  }
});

test("a real 401 offers sign-in without signing out any session", async () => {
  let calls = 0;
  const ui = harness(async () => ++calls === 1
    ? Response.json({ ok: false, signedIn: false }, { status: 401 }) : successfulStatus());
  ui.render();
  await settle();
  const tree = ui.render();
  assert.equal(ui.signOutCalls, 0);
  assert.ok(findAll(tree, "Link").some(node => node.props.href.startsWith("/sign-in?")));
  assert.equal(downloads(tree).length, 0);
  button(tree, "Retry access check").props.onClick();
  await settle();
  assert.equal(downloads(ui.render()).length, 1);
  assert.equal(ui.signOutCalls, 0);
  ui.unmount();
});

test("retry restores verified download access without touching auth", async () => {
  let calls = 0;
  const ui = harness(async () => ++calls === 1
    ? Response.json({ ok: false, signedIn: true }, { status: 500 }) : successfulStatus());
  ui.render();
  await settle();
  button(ui.render(), "Retry access check").props.onClick();
  let tree = ui.render();
  assert.ok(textOf(tree).includes("Checking your app access"));
  assert.equal(button(tree, "Start Free"), undefined);
  assert.equal(downloads(tree).length, 0);
  await settle();
  tree = ui.render();
  assert.equal(downloads(tree).length, 1);
  assert.equal(downloads(tree)[0].props.href, "/api/studio-os-app/download?platform=mac");
  assert.ok(textOf(tree).replace(/\s+/g, " ").includes("Signed in as photographer@example.test"));
  assert.equal(ui.signOutCalls, 0);
  assert.equal(calls, 2);
  ui.unmount();
});

test("timed-out checks abort and recover without an unhandled rejection or sign-out", async () => {
  let signal;
  const ui = harness(async (_, options) => {
    signal = options.signal;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  ui.render();
  ui.expireTimeout();
  await settle();
  assert.equal(signal.aborted, true);
  assert.ok(button(ui.render(), "Retry access check"));
  assert.equal(ui.signOutCalls, 0);
  assert.equal(ui.timerCount, 0);
  ui.unmount();
});

test("unmount aborts and ignores a late response", async () => {
  let resolve, signal;
  const ui = harness((_, options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  });
  ui.render();
  ui.unmount();
  const writes = ui.stateWrites;
  assert.equal(signal.aborted, true);
  assert.equal(ui.timerCount, 0);
  resolve(successfulStatus());
  await settle();
  assert.equal(ui.stateWrites, writes);
  assert.equal(ui.signOutCalls, 0);
  assert.equal(ui.timerCount, 0);
});

test("a superseded retry cannot replace the latest successful check", async () => {
  let calls = 0, resolveOld, oldSignal;
  const ui = harness(async (_, options) => {
    calls++;
    if (calls === 1) return Response.json({ ok: false }, { status: 500 });
    if (calls === 2) {
      oldSignal = options.signal;
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return successfulStatus();
  });
  ui.render();
  await settle();
  const retry = button(ui.render(), "Retry access check");
  retry.props.onClick();
  retry.props.onClick();
  await settle();
  assert.equal(oldSignal.aborted, true);
  assert.equal(downloads(ui.render()).length, 1);
  resolveOld(Response.json({ ok: false, signedIn: false }, { status: 401 }));
  await settle();
  assert.equal(downloads(ui.render()).length, 1);
  assert.equal(ui.signOutCalls, 0);
  assert.equal(ui.timerCount, 0);
  ui.unmount();
});

test("verified access still respects entitlement and release gates", async () => {
  for (const [canDownload, publicRelease] of [[false, true], [true, false]]) {
    const ui = harness(async () => Response.json({ ...validStatus, entitlement: { canDownload } }),
      { publicRelease, macReady: true, windowsReady: false });
    ui.render();
    await settle();
    assert.equal(downloads(ui.render()).length, 0);
    assert.equal(button(ui.render(), "Start Free"), undefined);
    assert.equal(ui.signOutCalls, 0);
    ui.unmount();
  }
});

test("the explicit sign-out control retains its behavior", async () => {
  const ui = harness(async () => successfulStatus());
  ui.render();
  await settle();
  await button(ui.render(), "Not you? Sign out").props.onClick();
  assert.equal(ui.signOutCalls, 1);
  assert.equal(ui.window.location.href, "/studio-os/download");
  ui.unmount();
});


test("MFA-required status offers verification instead of signup, download or outage retry", async () => {
  const ui = harness(async () => Response.json({ok:false, signedIn:true, mfaRequired:true, message:"Complete two-step verification to view your photographer keys and app access."}, {status:403}));
  ui.render(); await settle(); const tree = ui.render();
  assert.ok(textOf(tree).includes("Complete two-step verification"));
  assert.ok(findAll(tree, "Link").some(node => node.props.href.startsWith("/sign-in?redirect=%2Fstudio-os%2Fdownload")));
  assert.equal(button(tree,"Start Free"), undefined);
  assert.equal(downloads(tree).length,0);
  assert.equal(ui.signOutCalls,0);
  ui.unmount();
});

test("trial starts at signup without depending on an optional interest request", async () => {
  let calls=0;
  const ui = harness(async () => { calls++; return Response.json({ok:false,signedIn:false},{status:401}); });
  ui.render(); await settle(); let tree=ui.render();
  findAll(tree,"input")[0].props.onChange({target:{value:"photographer@example.invalid"}});
  tree=ui.render();
  await button(tree,"Start Free").props.onClick();
  assert.equal(calls,1);
  assert.ok(ui.window.location.href.startsWith("/sign-up?redirect=%2Fstudio-os%2Fdownload&source=download-app&email="));
  ui.unmount();
});

test("missing desktop entitlement is explained with plan and support recovery", async () => {
  const ui=harness(async()=>Response.json({...validStatus,entitlement:{canDownload:false}}));
  ui.render(); await settle(); const tree=ui.render();
  assert.ok(textOf(tree).includes("does not have desktop download access"));
  assert.ok(findAll(tree,"Link").some(node=>node.props.href === "/pricing"));
  assert.ok(findAll(tree,"a").some(node=>node.props.href === "mailto:hello@studiooscloud.com"));
  assert.ok(!textOf(tree).includes("Mac download coming soon"));
  assert.equal(downloads(tree).length,0);
  ui.unmount();
});
