import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { proxiedPhotoUrl } from "../lib/photo-url.ts";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function sourceSection(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return contents.slice(start, end);
}

const mobileSchoolsSource = source("app/m/schools/page.tsx");
const mobileSchoolDetailSource = source("app/m/schools/[id]/page.tsx");
const mobileSchoolCoverSource = source("components/school-cover-image.tsx");
const mobileEventSource = source("app/m/events/[id]/page.tsx");
const schoolDashboardSource = source(
  "app/dashboard/projects/schools/[schoolId]/page.tsx",
);
const assistantPanelSource = source(
  "components/studio-assistant/assistant-panel.tsx",
);
const orderNotificationSource = source("lib/order-notification-email.ts");
const orderReceiptSource = source("lib/order-receipt-email.ts");
const privateMediaSource = source("lib/private-media-references.ts");
const orderDownloadSource = source(
  "app/api/dashboard/orders/download/route.ts",
);
const eventVisitorsSource = source(
  "app/dashboard/projects/[id]/visitors/page.tsx",
);
const schoolVisitorsSource = source(
  "app/dashboard/projects/schools/[schoolId]/visitors/page.tsx",
);
const galleryContextSource = source("app/api/portal/gallery-context/route.ts");
const schoolAccessSource = source("app/api/portal/school-access/route.ts");
const eventContextSource = source(
  "app/api/portal/event-gallery-context/route.ts",
);
const storageFolderSource = source("lib/storage-folder.ts");
const storageImagesSource = source("lib/storage-images.ts");
const r2Source = source("lib/r2.ts");
const backdropsSource = source("app/dashboard/backdrops/page.tsx");
const albumSource = source(
  "app/dashboard/projects/[id]/albums/[albumId]/page.tsx",
);
const visitorEmailSource = source("app/api/dashboard/visitors/email/route.ts");
const orderNotifySource = source("app/api/dashboard/orders/notify/route.ts");
const eventDownloadReadySource = source(
  "app/api/portal/event-download-ready/route.ts",
);
const eventFavoritesSource = source(
  "app/api/dashboard/events/[id]/favorites/route.ts",
);
const dashboardHomeSource = source("app/dashboard/page.tsx");
const dashboardOrdersSource = source("app/dashboard/orders/page.tsx");

test("bare durable R2 image keys normalize to browser-safe proxy URLs", () => {
  assert.equal(
    proxiedPhotoUrl(
      "schools/school-1/Medical Office Assistant/Cover Photo 0001.jpg",
    ),
    "/api/r2/img/schools/school-1/Medical%20Office%20Assistant/Cover%20Photo%200001.jpg",
  );
});

test("mobile school and event covers normalize stored media references", () => {
  assert.match(
    mobileSchoolCoverSource,
    /import\s+\{\s*proxiedPhotoUrl\s*\}\s+from\s+["']@\/lib\/photo-url["']/,
  );
  assert.match(
    mobileSchoolCoverSource,
    /sources\.map\(\(source\) => proxiedPhotoUrl\(source\)\)/,
  );
  assert.match(
    mobileSchoolCoverSource,
    /onError=\{\(\) => setSourceIndex\(\(current\) => current \+ 1\)\}/,
  );
  assert.match(
    mobileSchoolsSource,
    /projectCoverBySchoolId\.get\(school\.id\)/,
  );
  assert.match(
    mobileSchoolsSource,
    /projectCoverByLocalId\.get\(clean\(school\.local_school_id\)\)/,
  );
  assert.match(mobileSchoolDetailSource, /\.eq\("linked_school_id", id\)/);
  assert.match(
    mobileSchoolDetailSource,
    /\.eq\("linked_local_school_id", localSchoolId\)/,
  );
  assert.match(
    mobileSchoolDetailSource,
    /\[\s*projectCover,\s*clean\(school\?\.cover_photo_url\),\s*\.\.\.students\.map/,
  );
  assert.match(
    mobileSchoolDetailSource,
    /function StudentThumbnail[\s\S]{0,700}onError=\{\(\) => setFailedSource\(normalizedSource\)\}/,
  );
  assert.match(
    mobileSchoolDetailSource,
    /<StudentThumbnail source=\{student\.photo_url\} \/>/,
  );
  assert.match(
    mobileEventSource,
    /import\s+\{\s*proxiedPhotoUrl\s*\}\s+from\s+["']@\/lib\/photo-url["']/,
  );
  assert.match(
    mobileEventSource,
    /const cover = proxiedPhotoUrl\(event\?\.cover_photo_url\);/,
  );
  assert.doesNotMatch(
    mobileEventSource,
    /const cover = clean\(event\?\.cover_photo_url\);/,
  );
});

test("school people-search thumbnails do not render raw database references", () => {
  assert.match(
    schoolDashboardSource,
    /src=\{proxiedPhotoUrl\(person\.photo_url\)\}/,
  );
  assert.doesNotMatch(schoolDashboardSource, /src=\{person\.photo_url\}/);
});

test("Studio Assistant normalizes popular-media and cover-suggestion thumbnails", () => {
  assert.match(
    assistantPanelSource,
    /import\s+\{\s*proxiedPhotoUrl\s*\}\s+from\s+["']@\/lib\/photo-url["']/,
  );

  const popularSection = sourceSection(
    assistantPanelSource,
    "function PopularMediaResult",
    "function UpsellSizesResult",
  );
  const coverSection = sourceSection(
    assistantPanelSource,
    "function CoverSuggestionsResult",
    "function chipLink",
  );

  assert.match(
    popularSection,
    /const photoUrl = proxiedPhotoUrl\([\s\S]{0,120}row\.photo_url/,
  );
  assert.match(popularSection, /src=\{photoUrl\}/);
  assert.match(
    coverSection,
    /const photoUrl = proxiedPhotoUrl\([\s\S]{0,120}c\.photo_url/,
  );
  assert.match(coverSection, /src=\{photoUrl\}/);
});

test("order notification and receipt emails sign bare durable thumbnail keys", () => {
  assert.match(privateMediaSource, /function isBareMediaKey\(value: string\)/);
  assert.match(
    privateMediaSource,
    /export function signedPrivateMediaReference\([\s\S]{0,500}const key = safeR2Key\(raw\)/,
  );

  for (const emailSource of [orderNotificationSource, orderReceiptSource]) {
    assert.match(
      emailSource,
      /import\s+\{\s*signedPrivateMediaReference\s*\}\s+from\s+["']\.\/private-media-references["']/,
    );
    assert.match(
      emailSource,
      /signedPrivateMediaReference\(raw,\s*60 \* 60 \* 24 \* 7\)/,
    );
  }

  assert.match(
    orderNotificationSource,
    /url: clean\(item\.sku\),[\s\S]{0,100}\.filter\(\(item\) => Boolean\(item\.url\)\)/,
  );
  assert.doesNotMatch(
    orderNotificationSource,
    /filter\(\(item\) => isWebImageUrl\(item\.url\)\)/,
  );
  assert.match(
    orderReceiptSource,
    /return emailImageUrl\(item\.sku\) \|\| emailImageUrl\(notePhotos\[index\]\?\.url\);/,
  );
  assert.doesNotMatch(orderReceiptSource, /isWebImageUrl\(item\.sku\)/);
});

test("dashboard order downloads sign bare durable photo keys before fetching", () => {
  assert.match(
    orderDownloadSource,
    /privateMediaKeyFromReference[\s\S]{0,120}signedPrivateMediaReference[\s\S]{0,120}from\s+["']@\/lib\/private-media-references["']/,
  );

  const downloadPhotoSection = sourceSection(
    orderDownloadSource,
    "function downloadPhotoUrl",
    "function formatDate",
  );
  assert.match(
    downloadPhotoSection,
    /const resolved = signedPrivateMediaReference\(raw,\s*60 \* 60\);/,
  );
  assert.doesNotMatch(downloadPhotoSection, /new URL\(raw\)/);

  const displayItemsSection = sourceSection(
    orderDownloadSource,
    "function resolveOrderDisplayItems",
    "async function resolveBackdropForDownload",
  );
  assert.match(
    orderDownloadSource,
    /function isPhotoReference[\s\S]{0,260}privateMediaKeyFromReference\(raw\)/,
  );
  assert.match(
    displayItemsSection,
    /dbItems\.filter\(\(item: \{ sku\?: string \}\) => isPhotoReference\(item\.sku\)\)/,
  );
  assert.match(displayItemsSection, /photoUrl: isPhotoReference\(item\.sku\)/);
  assert.doesNotMatch(displayItemsSection, /isWebImageUrl\(item\.sku\)/);
});

test("event and school visitor order pages proxy thumbnail references", () => {
  for (const visitorsSource of [eventVisitorsSource, schoolVisitorsSource]) {
    assert.match(
      visitorsSource,
      /import\s+\{\s*proxiedPhotoUrl\s*\}\s+from\s+["']@\/lib\/photo-url["']/,
    );
    assert.match(
      visitorsSource,
      /function imageUrlFromSku\([\s\S]{0,160}return proxiedPhotoUrl\(value\) \|\| null;/,
    );
  }
});

test("gallery, school, and event portal logos refresh private R2 references", () => {
  for (const portalSource of [
    galleryContextSource,
    schoolAccessSource,
    eventContextSource,
  ]) {
    assert.match(
      portalSource,
      /signedPrivateMediaReference\(\s*photographer\??\.watermark_logo_url,\s*SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,?\s*\)/,
    );
    assert.match(
      portalSource,
      /signedPrivateMediaReference\(\s*photographer\??\.logo_url,\s*SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,?\s*\)/,
    );
    assert.match(
      portalSource,
      /const resolvedLogoUrl = looksLikeImageAssetUrl\(watermarkLogoCandidate\)/,
    );
  }
});

test("parent folder media uses the six-hour portal TTL end to end", () => {
  assert.match(
    storageImagesSource,
    /SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS = 60 \* 60 \* 6/,
  );
  assert.match(
    r2Source,
    /listR2FolderImages\([\s\S]{0,220}options\?: \{ ttlSeconds\?: number \}[\s\S]{0,220}const ttlSeconds = options\?\.ttlSeconds \?\? 60 \* 60/,
  );
  assert.match(r2Source, /url: r2PresignedGetUrl\(key, ttlSeconds\)/);
  assert.match(
    storageFolderSource,
    /loadFolderMediaRows\([\s\S]{0,220}ttlSeconds\?: number/,
  );
  assert.match(
    storageFolderSource,
    /listR2FolderImages\(folderPath, \{ ttlSeconds: options\?\.ttlSeconds \}\)/,
  );

  for (const portalSource of [galleryContextSource, schoolAccessSource]) {
    assert.match(
      portalSource,
      /loadFolderMediaRows\([\s\S]{0,850}ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,[\s\S]{0,80}\},?\s*\)/,
    );
  }
});

test("backdrop editor and newly uploaded album photos normalize durable keys", () => {
  assert.match(
    backdropsSource,
    /const editPreviewUrl = proxiedPhotoUrl\(editUrl\);/,
  );
  assert.match(backdropsSource, /src=\{editPreviewUrl\}/);
  assert.doesNotMatch(backdropsSource, /src=\{editUrl\}/);

  const albumGridSection = sourceSection(
    albumSource,
    "{media.map((item, index) => {",
    "const selected = selectedIds.includes(item.id);",
  );
  assert.match(
    albumGridSection,
    /buildStoredMediaUrls\(\{[\s\S]{0,220}storagePath: item\.storage_path[\s\S]{0,220}thumbnailUrl: item\.thumbnail_url/,
  );
  assert.doesNotMatch(
    albumGridSection,
    /const src = clean\(item\.thumbnail_url\)/,
  );
});

test("all server-rendered operational logos refresh private R2 references", () => {
  for (const emailSource of [visitorEmailSource, orderNotifySource]) {
    assert.match(
      emailSource,
      /const logoUrl = signedPrivateMediaReference\([\s\S]{0,160}60 \* 60 \* 24 \* 7/,
    );
  }

  assert.match(
    eventDownloadReadySource,
    /signedPrivateMediaReference\(\s*photographerRow\.watermark_logo_url,\s*SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS/,
  );
  assert.match(
    eventDownloadReadySource,
    /signedPrivateMediaReference\(\s*photographerRow\.logo_url,\s*SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS/,
  );
});

test("event favorite cover fallbacks are signed before reaching the browser", () => {
  assert.match(
    eventFavoritesSource,
    /cover_photo_url:\s*signedPrivateMediaReference\(\s*row\.cover_photo_url,\s*SIGNED_URL_TTL_DASHBOARD_SECONDS/,
  );
  assert.doesNotMatch(
    eventFavoritesSource,
    /const collectionMap = new Map\(\s*collections\.map\(\(row\) => \[row\.id, row\]/,
  );
});

test("active dashboard branding previews proxy private logo references", () => {
  assert.match(
    dashboardHomeSource,
    /const displayLogoUrl = proxiedPhotoUrl\(logoUrl\);/,
  );
  assert.match(dashboardHomeSource, /src=\{displayLogoUrl\}/);
  assert.match(
    dashboardOrdersSource,
    /logoUrl: proxiedPhotoUrl\([\s\S]{0,140}\.logo_url as string/,
  );

  for (const visitorsSource of [eventVisitorsSource, schoolVisitorsSource]) {
    assert.match(
      visitorsSource,
      /logoUrl: proxiedPhotoUrl\(p\.logo_url as string\)/,
    );
  }
});
