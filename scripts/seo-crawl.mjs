#!/usr/bin/env node

const baseUrl = process.argv[2] ?? process.env.SITE_URL ?? "http://localhost:3000";
const productionOrigin = "https://www.studiooscloud.com";
const privateNoindexPaths = [
  "/parents",
  "/sign-in",
  "/forgot-password",
  "/reset-password",
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function normalizeUrl(value) {
  return value.replace(/\/$/, "");
}

function localUrlForProductionUrl(url) {
  const parsed = new URL(url);
  return new URL(`${parsed.pathname}${parsed.search}`, baseUrl).toString();
}

function findAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function findMetaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const tag = tags.find((entry) => findAttribute(entry, "name") === name);
  return tag ? findAttribute(tag, "content") : null;
}

function findCanonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  const tag = tags.find((entry) => {
    const rel = findAttribute(entry, "rel");
    return rel?.split(/\s+/).includes("canonical");
  });
  return tag ? findAttribute(tag, "href") : null;
}

function extractSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    match[1].trim(),
  );
}

function extractDisallows(robotsText) {
  return robotsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^disallow:/i.test(line))
    .map((line) => line.replace(/^disallow:\s*/i, "").trim())
    .filter(Boolean);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
  });
  const text = await response.text();
  return { response, text };
}

async function run() {
  console.log(`SEO crawl target: ${baseUrl}`);

  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  const { response: robotsResponse, text: robotsText } = await fetchText(
    robotsUrl,
  );

  if (robotsResponse.status !== 200) {
    fail(`/robots.txt returned ${robotsResponse.status}`);
  }

  if (!robotsText.includes(`Sitemap: ${productionOrigin}/sitemap.xml`)) {
    fail("/robots.txt does not point to the production www sitemap");
  }

  const disallows = extractDisallows(robotsText);

  const sitemapUrl = new URL("/sitemap.xml", baseUrl).toString();
  const { response: sitemapResponse, text: sitemapText } = await fetchText(
    sitemapUrl,
  );

  if (sitemapResponse.status !== 200) {
    fail(`/sitemap.xml returned ${sitemapResponse.status}`);
  }

  const sitemapUrls = extractSitemapUrls(sitemapText);
  const sitemapUrlSet = new Set(sitemapUrls.map(normalizeUrl));

  if (sitemapUrls.length === 0) {
    fail("/sitemap.xml contains no URLs");
  }

  for (const requiredPath of [
    "/",
    "/pricing",
    "/sample-galleries",
    "/studio-os",
    "/online-photo-gallery-ordering-software",
    "/photography-workflow-software",
  ]) {
    const expectedUrl =
      requiredPath === "/"
        ? productionOrigin
        : `${productionOrigin}${requiredPath}`;
    if (!sitemapUrlSet.has(normalizeUrl(expectedUrl))) {
      fail(`/sitemap.xml is missing ${expectedUrl}`);
    }
  }

  for (const privatePath of privateNoindexPaths) {
    const privateUrl = normalizeUrl(`${productionOrigin}${privatePath}`);
    if (sitemapUrlSet.has(privateUrl)) {
      fail(`/sitemap.xml includes private/noindex path ${privatePath}`);
    }
  }

  for (const sitemapUrlEntry of sitemapUrls) {
    const productionUrl = new URL(sitemapUrlEntry);
    const path = productionUrl.pathname;

    for (const disallow of disallows) {
      if (disallow !== "/" && path.startsWith(disallow)) {
        fail(`${sitemapUrlEntry} is blocked by robots.txt rule ${disallow}`);
      }
    }

    const fetchUrl = localUrlForProductionUrl(sitemapUrlEntry);
    const { response, text } = await fetchText(fetchUrl);
    const xRobots = response.headers.get("x-robots-tag") ?? "";

    if (response.status !== 200) {
      fail(`${path} returned ${response.status}`);
      continue;
    }

    if (/noindex/i.test(xRobots) || /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(text)) {
      fail(`${path} is marked noindex but appears in the sitemap`);
    }

    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();
    if (!title || title.length < 12) {
      fail(`${path} is missing a useful <title>`);
    }

    const description = findMetaContent(text, "description");
    if (!description || description.length < 50) {
      fail(`${path} is missing a useful meta description`);
    }

    const canonical = findCanonical(text);
    const expectedCanonical = normalizeUrl(sitemapUrlEntry);
    if (normalizeUrl(canonical ?? "") !== expectedCanonical) {
      fail(
        `${path} canonical mismatch: expected ${expectedCanonical}, got ${canonical ?? "none"}`,
      );
    }
  }

  for (const privatePath of privateNoindexPaths) {
    const privateUrl = new URL(privatePath, baseUrl).toString();
    const { response, text } = await fetchText(privateUrl);
    const xRobots = response.headers.get("x-robots-tag") ?? "";
    const hasMetaNoindex =
      /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(text);

    if (response.status !== 200) {
      fail(`${privatePath} returned ${response.status}; expected reachable noindex page`);
      continue;
    }

    if (!/noindex/i.test(xRobots) && !hasMetaNoindex) {
      fail(`${privatePath} is not protected with noindex`);
    }
  }

  if (failures.length > 0) {
    console.error("\nSEO crawl failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`SEO crawl passed for ${sitemapUrls.length} public sitemap URLs.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
