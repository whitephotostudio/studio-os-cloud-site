# Security Patch 5 — Private R2 Readiness

Date: July 22, 2026 (EDT)

## Outcome

Studio OS Cloud no longer creates new permanent public R2 references in its active server upload and folder-listing paths. Owned R2 images are read through an authenticated proxy or a short-lived signed Cloudflare URL. Existing Supabase backdrop references and historical R2 references remain compatible.

Cloudflare R2 public access is deliberately still enabled. This patch prepares the website for a later private-bucket switch; it does not perform that switch.

## Changes

- New server uploads return and store durable R2 object keys instead of permanent `r2.dev` URLs.
- R2 folder listings return one-hour signed GET URLs.
- The authenticated image proxy now authorizes every active owned namespace:
  - photographer-root and legacy thumbnail paths;
  - backdrops;
  - projects and probes;
  - schools and photos;
  - nested project/school no-background paths; and
  - legacy local-school paths.
- Parent school/gallery responses convert eligible backdrop R2 references into six-hour signed URLs.
- The dashboard backdrop page routes private-ready references through the authenticated image proxy.
- The generic portal file downloader no longer accepts public `r2.dev` origins. This prevents it from becoming an authorization bypass after the bucket is private.
- Unauthorized proxy logs no longer include photographer IDs or object paths.

## Compatibility audit

- All 94 currently stored backdrop image/thumbnail references for the photographer are intentional Supabase public-storage references.
- No current backdrop reference uses R2, so the absence of objects under the newer R2 backdrop prefix is expected.
- Real owned project and school R2 objects were tested through the authenticated proxy.
- Existing database rows were not rewritten.
- Existing photos were not moved, uploaded, deleted, or modified.

## Verification performed

- Website security tests: 26/26 passed.
- Targeted ESLint: zero errors; eight pre-existing warnings only.
- `git diff --check`: passed.
- Local Next.js production build: passed, all 76 static pages generated.
- Vercel preview production build: passed.
- Preview public pages and parent choices: HTTP 200.
- Preview anonymous image proxy: HTTP 401.
- Preview anonymous R2 gateway: HTTP 401.
- Preview generic public-R2 download attempt: HTTP 403.
- Preview authenticated real project object: proxy HTTP 302, signed object byte HTTP 206.
- Preview authenticated real school object: proxy HTTP 302, signed object byte HTTP 206.
- The same public, anonymous-denial, and authenticated real-object checks passed after production promotion.
- No real delivery email was sent.
- No booking, student, order, media, photo, or Cloudflare R2 public-access setting was changed by these tests.

## Deployments

Tested preview:

- Deployment: `dpl_B2BBtvxwRitBzaFZj9wKmEzUCADp`
- URL: `https://studio-os-cloud-site-jqdewpta8-whitephotostudio-7289s-projects.vercel.app`

Production promotion:

- Deployment: `dpl_3vEjcv7qYf1zW3CD1fDTVpzt8o2i`
- URL: `https://studio-os-cloud-site-dbvmhnid9-whitephotostudio-7289s-projects.vercel.app`
- Primary alias: `https://www.studiooscloud.com`

Previous production rollback:

- Deployment: `dpl_8AX11FVLhXuRpEdbyB2mV1cCzJDN`
- URL: `https://studio-os-cloud-site-15hxhnkga-whitephotostudio-7289s-projects.vercel.app`

## Rollback procedure

If a website storage workflow behaves differently:

1. Keep Cloudflare R2 public access enabled.
2. Promote deployment `dpl_8AX11FVLhXuRpEdbyB2mV1cCzJDN` in Vercel.
3. Verify `/`, `/parents`, and `/api/portal/choices` return HTTP 200.
4. Sign in to the dashboard and verify one school image and one project image.
5. Do not rewrite database media references as part of rollback.

The installed Flutter app did not change in this patch, so no app rollback is required for Patch 5 itself.

## Next stage safety gate

Do not disable Cloudflare R2 public access until a separate final private-mode exercise has:

1. captured a fresh source and configuration backup;
2. recorded the current Cloudflare setting and Vercel rollback deployment;
3. verified authenticated dashboard, school, project, no-background, composite, parent gallery, parent download, and Desktop upload/download workflows;
4. confirmed no active runtime path still depends on a permanent public R2 URL; and
5. defined an immediate re-enable procedure for public R2 access.
