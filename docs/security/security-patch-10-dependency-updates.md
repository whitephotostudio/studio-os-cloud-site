# Security Patch 10: Production Dependency Updates

Date: July 23, 2026 (EDT)

## Safety boundary

This patch is being prepared and validated locally. No Vercel deployment,
production alias, Supabase schema/data, Cloudflare/R2 configuration, booking,
payment, gallery, order, or desktop application behavior may be changed until
the local build and focused regression checks pass and the owner approves a
production deployment.

## Verified rollback point

The complete pre-change source and signed application snapshot is:

`/Volumes/StudioOS Security Backup/2026-07-23_security-final`

The prior complete cloud/Supabase/R2 backup remains:

`/Volumes/StudioOS Security Backup/2026-07-22_post_security`

## Baseline audit

`npm audit --omit=dev` reported 151 production dependencies and seven
production findings:

- 4 high
- 3 moderate
- 0 critical

The vulnerable dependency paths were:

- Next.js and its bundled PostCSS/Sharp dependencies
- the direct Sharp/libvips image-processing dependency
- AWS S3 client's XML helper dependencies
- Supabase Realtime's compatible `ws` transitive dependency

Relevant advisories include the Next.js security advisories returned by npm,
Sharp advisory `GHSA-f88m-g3jw-g9cj`, PostCSS advisory
`GHSA-qx2v-qp2m-jg93`, WebSocket advisories `GHSA-58qx-3vcg-4xpx` and
`GHSA-96hv-2xvq-fx4p`, and XML advisories `GHSA-gh4j-gqv2-49f6` and
`GHSA-5wm8-gmm8-39j9`.

## Minimal candidate

A temporary package-lock candidate was created before modifying the working
project. It uses:

- `next` 16.2.11
- matching `eslint-config-next` 16.2.11
- matching optional `@next/swc-darwin-arm64` 16.2.11
- `sharp` 0.35.3
- `@aws-sdk/client-s3` 3.1093.0
- compatible transitive `ws` 8.21.1
- an npm override to PostCSS 8.5.10
- an npm override to keep all Sharp consumers on 0.35.3

The temporary candidate reported zero production vulnerabilities. Sharp 0.35
requires Node.js 20.9 or later; the validation machine runs Node.js 24.17.0.
Source inspection found no use of the Sharp APIs removed in 0.35.

## Validation required before deployment

- Clean dependency installation from the candidate lockfile
- `npm audit --omit=dev`
- Security regression tests
- TypeScript/Next.js production build
- Lint review, separating pre-existing warnings from new failures
- Image resize/thumbnail/composite smoke checks under Sharp 0.35
- Public home, booking, sign-in, and gallery route checks against the local build
- Focused API/source tests for booking, payments, orders, downloads, and private
  media protections
- Production deployment review and explicit owner approval

## Local validation completed

Completed July 23, 2026:

- `npm audit --omit=dev`: zero production vulnerabilities.
- Installed dependency tree: valid, with one Sharp 0.35.3 installation shared
  by the application and Next.js.
- Security regression tests: 28 of 28 passed.
- Sharp smoke test: decoded SVG, resized, composited, encoded JPEG, and read
  metadata successfully using Sharp 0.35.3 and libvips 8.18.3.
- `next build`: passed under Next.js 16.2.11.
- TypeScript validation performed by `next build`: passed.
- Static generation: all 76 pages completed.
- Critical build manifest check: booking, sign-in, Stripe checkout/webhook,
  portal order creation/history, download, gallery context, dashboard MFA, and
  private R2 access routes were all present.
- Local production-server smoke test: home, booking, sign-in, pricing, parents,
  and dashboard settings returned HTTP 200.
- Local booking and sign-in pages contained their expected visible content.
- Unauthenticated local requests to dashboard MFA, school creation, private R2
  access, and the private image proxy were rejected rather than granted access.
- The local test server was stopped after validation. No test created a booking,
  payment, order, upload, download token, or cloud data change.
- The final `package.json` and `package-lock.json` exactly matched the temporary
  zero-advisory candidate tested before the working project was changed.

The repository-wide `npm run lint` command still fails because it scans retained
generated `.next.*` cache directories and also reports existing source-rule
violations. This dependency patch does not alter unrelated application code or
hide those findings. The production build and TypeScript checks pass.

## Production status

Deployed after explicit owner approval on July 23, 2026.

The exact validated preview was promoted to production. Vercel created the
Ready production deployment:

`dpl_BVqQ4FjdUNfuaYSuPijKVUBQZgnN`

Immediate rollback deployment:

`dpl_36WCurofAEqH9ESj1VcDVgvKNCRa`

Vercel confirmed that `www.studiooscloud.com`, `studiooscloud.com`,
`studioos.ca`, `www.studioos.ca`, `studiooscloud.ca`, and
`www.studiooscloud.ca` point to the new production deployment.

## Hosted preview validation

Vercel preview deployment `dpl_mFZwjuRiVbhazWRY9snf7cpnKikz` completed with
status Ready at:

`https://studio-os-cloud-site-19qh8mgvu-whitephotostudio-7289s-projects.vercel.app`

Hosted checks completed July 23, 2026:

- Home, booking, sign-in, pricing, and parent routes returned HTTP 200.
- Booking and sign-in pages contained their expected visible content.
- Dashboard MFA, school creation, private R2 access, and private-image requests
  rejected unauthenticated access with HTTP 401.
- Gallery-context GET returned HTTP 405 because the route accepts a different
  method, and a download request without required inputs returned HTTP 400;
  both routes loaded without a server failure.
- No preview request created or modified a booking, payment, order, gallery,
  file, or database record.
- The production booking page continued to return HTTP 200 throughout preview
  validation.

## Post-production validation

- Home, booking, sign-in, pricing, parents, and dashboard settings returned
  HTTP 200 on `www.studiooscloud.com`.
- Booking and sign-in pages contained their expected visible content.
- Booking routes returned HTTP 200 through every custom Studio OS domain.
- Dashboard MFA, school creation, private R2 access, and the private image proxy
  continued to reject unauthenticated requests with HTTP 401.
- Vercel reported the promoted deployment Ready and all production aliases
  attached.
- A post-deployment log query found no HTTP 500 requests for the new deployment.
- No post-deployment validation request created or modified a booking, payment,
  order, gallery, file, or database record.

No secret, password, token, TOTP value, session cookie, or private key belongs
in this runbook.
