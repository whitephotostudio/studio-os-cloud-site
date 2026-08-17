import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { summarizeCloudFlow } from "../../lib/cloud-flow.ts";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const routeSource = source("app/api/dashboard/admin/cloud-flow/route.ts");
const pageSource = source("app/dashboard/admin/cloud-flow/page.tsx");
const sidebarSource = source("components/dashboard-sidebar.tsx");

function flowCard(status) {
  return {
    id: status,
    title: status,
    category: "infrastructure",
    status,
    summary: "summary",
    detail: "detail",
    metric: "metric",
    metricLabel: "label",
    lastActivity: null,
    checkedAt: new Date(0).toISOString(),
  };
}

test("Cloud Flow ranks critical and warning evidence truthfully", () => {
  assert.equal(summarizeCloudFlow([flowCard("healthy"), flowCard("manual")]).status, "healthy");
  assert.equal(summarizeCloudFlow([flowCard("healthy"), flowCard("warning")]).status, "warning");
  assert.equal(summarizeCloudFlow([flowCard("warning"), flowCard("critical")]).status, "critical");
});

test("Cloud Flow API requires a real platform-admin session", () => {
  assert.match(routeSource, /resolveDashboardAuth\(request\)/);
  assert.match(routeSource, /if \(!user\)/);
  assert.match(routeSource, /photographer\.is_platform_admin/);
  assert.match(routeSource, /status: 401/);
  assert.match(routeSource, /status: 403/);
  assert.match(routeSource, /Only the Studio OS Cloud owner can view Cloud Flow/);
});

test("Cloud Flow checks are read-only and do not query customer PII", () => {
  assert.doesNotMatch(routeSource, /\.insert\s*\(/);
  assert.doesNotMatch(routeSource, /\.update\s*\(/);
  assert.doesNotMatch(routeSource, /\.upsert\s*\(/);
  assert.doesNotMatch(routeSource, /\.delete\s*\(/);
  assert.doesNotMatch(
    routeSource,
    /parent_email|viewer_email|student_first_name|student_last_name|access_pin|public_token/,
  );
  assert.match(routeSource, /MaxKeys: 1/);
  assert.match(routeSource, /Cache-Control["']:\s*["']private, no-store/);
});

test("Cloud Flow keeps server credentials out of the owner browser", () => {
  assert.doesNotMatch(pageSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(pageSource, /R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(pageSource, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(pageSource, /UPSTASH_REDIS_REST_TOKEN/);
  assert.doesNotMatch(pageSource, /PUSHOVER_APP_TOKEN/);
  assert.match(pageSource, /\/api\/dashboard\/admin\/cloud-flow/);
});

test("Cloud Flow navigation remains inside the owner-only sidebar section", () => {
  assert.match(sidebarSource, /\{isAdmin && \(/);
  assert.match(sidebarSource, /href="\/dashboard\/admin\/cloud-flow"/);
  const ownerSection = sidebarSource.slice(sidebarSource.indexOf("{isAdmin && ("));
  assert.match(ownerSection, /Cloud Flow/);
});
