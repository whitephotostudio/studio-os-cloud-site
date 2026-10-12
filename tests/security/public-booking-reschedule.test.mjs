import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(source(relativePath), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => name === "@/lib/content-security-policy"
    ? loadTypeScript("lib/content-security-policy.ts") : require(name), loaded, loaded.exports);
  return loaded.exports;
}

async function renderedRoute(relativePath, headers = {}) {
  const routeModule = loadTypeScript(relativePath);
  const response = await routeModule.GET(new Request("https://www.studiooscloud.com/", { headers }));
  return { response, html: await response.text() };
}

function assertInlineScriptParses(html) {
  const script = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "route should contain its booking-page script");
  assert.doesNotThrow(() => new Function(script));
}

test("manage page makes rescheduling primary and keeps cancellation recoverable", async () => {
  const route = source("app/manage/route.ts");
  const { response, html } = await renderedRoute("app/manage/route.ts");

  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(html, />Change date or time</);
  assert.match(html, />Choose another time instead</);
  assert.match(html, />Keep my appointment</);
  assert.match(html, /Your current appointment stays reserved until you confirm a new time/);
  assert.match(html, /cancelToReschedule.*addEventListener\('click',openReschedule\)/s);
  assert.match(html, /role='alert' aria-live='assertive'/);
  assertInlineScriptParses(html);

  assert.match(route, /fetch\('\/api\/public\/booking-manage\?token='/);
  assert.match(route, /fetch\('\/api\/public\/booking-manage',\{method:'POST'/);
  assert.doesNotMatch(route, /supabase\.co\/functions\/v1/);
});

test("booking and management scripts carry the response CSP nonce and never cache another parent's nonce", async () => {
  const supplied = Buffer.from("trusted-proxy-nonce").toString("base64");
  for (const relativePath of ["app/book/route.ts", "app/manage/route.ts"]) {
    const { response, html } = await renderedRoute(relativePath, { "x-nonce": supplied });
    const scriptNonce = html.match(/<script nonce="([A-Za-z0-9+/=]+)">/)?.[1];
    assert.equal(scriptNonce, supplied);
    const policy = response.headers.get("content-security-policy");
    assert.match(policy, new RegExp(`script-src 'self' 'nonce-${supplied}' 'strict-dynamic'`));
    assert.doesNotMatch(policy.match(/script-src[^;]+/)[0], /unsafe-inline/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(loadTypeScript(relativePath).dynamic, "force-dynamic");
    assertInlineScriptParses(html);
    const invalid = await renderedRoute(relativePath, { "x-nonce": '\" onload=\"alert(1)' });
    const fallbackNonce = invalid.html.match(/<script nonce="([A-Za-z0-9+/=]+)">/)?.[1];
    assert.match(fallbackNonce, /^[A-Za-z0-9+/=]{16,}$/);
    assert.ok(invalid.response.headers.get("content-security-policy").includes(`'nonce-${fallbackNonce}'`));
    assert.equal(invalid.html.includes('onload="alert(1)'), false);
    const fresh = await renderedRoute(relativePath);
    assert.notEqual(fresh.html.match(/<script nonce="([A-Za-z0-9+/=]+)">/)?.[1], fallbackNonce);
  }
});

test("manage page renders optional current, slot, and safe rebooking locations", async () => {
  const { html } = await renderedRoute("app/manage/route.ts");

  assert.match(html, /currentLocationName/);
  assert.match(html, /currentLocationAddress/);
  assert.match(html, /placeOf\(\[slot,S\.bk,S\.data&&S\.data\.event,S\.data\],false\)/);
  assert.match(html, /Array\.isArray\(source\.rebookEvents\)/);
  assert.match(html, /Available appointments/);
  assert.match(html, />Book another appointment</);
  assert.match(html, /Choosing one creates a separate new booking/);
  assert.match(html, /expectedPath/);
  assert.match(html, /url\.hostname === 'www\.studiooscloud\.com'/);
  assert.match(html, /path !== expectedPath/);
  assert.match(html, /url\.username \|\| url\.password/);
  assert.match(html, /rel='noreferrer'/);
  assert.match(html, /action\.rel='noreferrer'/);
  assert.match(html, /url\.searchParams\.set\('credit','1'\)/);
});

test("booking page keeps booked slots and lunch while adding locations and manage CTA", async () => {
  const route = source("app/book/route.ts");
  const { html } = await renderedRoute("app/book/route.ts");

  assert.match(html, /\.slot\.taken\{background:#fdecec/);
  assert.match(html, /class="slot taken" type=button disabled title="Booked"/);
  assert.match(html, /🍴 LUNCH <span>12:30 PM–1:00 PM · Not available<\/span>/);
  assert.match(html, /id='eventwhere'/);
  assert.match(html, /id='pickedwhere'/);
  assert.match(html, /placeOf\(\[s,S\.ev\]\)/);
  assert.match(html, /Manage or change this booking/);
  assert.match(html, /params\.get\('credit'\) === '1'/);
  assert.match(html, /Studio credit is applied automatically when you use the same email/);
  assert.match(html, /safeManageUrl\(d\.manageUrl \|\| d\.manage_url/);
  assert.match(html, /path!=='\/manage'/);
  assert.match(html, /manage\.href=S\.manageUrl/);
  assertInlineScriptParses(html);

  assert.match(route, /fetch\('\/api\/public\/booking-availability\?event='/);
  assert.match(route, /base \+ '\/booking-create'/);
});

test("public booking proxies validate bearer IDs, bound writes, and rate-limit both IP and token", () => {
  const helper = source("lib/public-booking.ts");
  const availability = source("app/api/public/booking-availability/route.ts");
  const manage = source("app/api/public/booking-manage/route.ts");

  assert.match(helper, /if \(!PUBLIC_BOOKING_UUID_RE\.test\(eventId\)\) return null/);
  assert.match(helper, /if \(!PUBLIC_BOOKING_UUID_RE\.test\(token\)\) return null/);
  assert.match(manage, /MAX_MUTATION_BODY_CHARS = 4_096/);
  assert.match(manage, /contentType\.startsWith\("application\/json"\)/);
  assert.match(manage, /await request\.text\(\)/);
  assert.match(manage, /text\.length > MAX_MUTATION_BODY_CHARS/);
  assert.match(manage, /public-booking-manage-\$\{kind\}-ip/);
  assert.match(manage, /public-booking-manage-\$\{kind\}-token/);
  assert.match(manage, /rateLimit\(tokenKey\(token\)/);
  assert.doesNotMatch(manage, /data\.error\.slice/);
  assert.match(manage, /console\.error\("\[public-booking-manage:get\]", errorName\(error\)\)/);
  assert.match(manage, /console\.error\("\[public-booking-manage:post\]", errorName\(error\)\)/);
  assert.doesNotMatch(availability, /return publicJson\(data, upstream\.status/);
});

test("related-event name matching remains suggestion-only and price/currency guarded", () => {
  const helper = source("lib/public-booking.ts");
  const loader = helper.match(/export async function loadPublicRebookEvents[\s\S]*$/)?.[0] ?? "";

  assert.match(helper, /Name similarity is\s+ \* used only to rank public booking links/s);
  assert.match(loader, /\.eq\("photographer_id", current\.photographerId\)/);
  assert.match(loader, /\.eq\("enabled", true\)/);
  assert.match(loader, /Number\(event\.sitting_fee_cents \?\? 0\) === currentFee/);
  assert.match(loader, /clean\(event\.currency\)\.toLowerCase\(\) === currentCurrency/);
  assert.match(loader, /likelySameSchoolName\(currentSchoolName, school\.school_name\)/);
  assert.match(loader, /"booking-availability"/);
  assert.doesNotMatch(loader, /"booking-manage"/);
  assert.doesNotMatch(loader, /method:\s*"POST"/);
  assert.doesNotMatch(loader, /booking-create/);
});
