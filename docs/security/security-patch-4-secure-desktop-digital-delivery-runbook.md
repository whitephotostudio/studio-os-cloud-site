# Security Patch 4 — Secure Desktop Digital Delivery

Date: July 22, 2026 (EDT)

## Outcome

The Studio OS Desktop Digital Orders workflow now uploads through the authenticated R2 gateway and asks Studio OS Cloud to send one encrypted, order-bound, expiring ZIP link. The Desktop app no longer calls the legacy `send-digital-delivery` Edge Function.

The legacy Edge Function remains deployed and unchanged as a rollback path for older app builds.

## Server enforcement

Before an email can be sent, the new dashboard endpoint independently verifies:

- the Supabase bearer session;
- the current Studio OS agreement;
- the photographer profile and order ownership;
- a paid/eligible order status;
- the order's database email (the app cannot substitute a recipient);
- the exact `photos/{school_id}/{student_id}/` prefix;
- a bounded list of supported photo files;
- the existence of every R2 object; and
- a per-photographer rate limit.

Only after Resend accepts the email does the server mark the order `digital_sent`. Retries use an order-and-manifest idempotency key.

## Parent download protection

- Download metadata is compressed and encrypted with AES-256-GCM.
- The token is bound to the order, recipient email, exact object keys, and expiration time.
- Object paths and recipient email are not readable in the URL.
- Links expire after 30 days.
- Every download re-checks payment, order email, school/student binding, token integrity, and expiration.
- The ZIP is streamed through Studio OS Cloud with `private, no-store`, `nosniff`, and `no-referrer` response controls.

## Desktop changes

- The app sends full R2 object keys to the new authenticated endpoint.
- Failed uploads are now detected and stop the send workflow.
- R2 master credentials remain absent from the app.
- Startup diagnostics no longer print the full Supabase user profile, email, identity IDs, or login history.

## Verification performed

- Website security tests: 22/22 passed.
- Flutter tests: 9/9 passed.
- Targeted website lint: passed.
- Next.js production build: passed.
- Flutter macOS release build: passed.
- App code-signature verification: passed.
- Preview unauthenticated send: HTTP 401.
- Preview missing/forged download token: HTTP 400.
- Preview authenticated fake order: HTTP 404.
- Preview authenticated paid order with the wrong student path: HTTP 400.
- Preview locally encrypted fake-order token: decrypted and stopped at order lookup with HTTP 404.
- No real delivery email was sent during development or verification.
- No photo, booking, student, order, or media record was changed by the tests.

Production counts after deployment and final app installation:

- bookings: 50
- students: 210
- orders: 179
- media: 6,454

## Deployments

Tested preview:

- Deployment: `dpl_9MnHRzom6Acnyz46ryj2GLJ6kRCW`
- URL: `https://studio-os-cloud-site-pzoyyvdxz-whitephotostudio-7289s-projects.vercel.app`

Production promotion:

- Deployment: `dpl_8AX11FVLhXuRpEdbyB2mV1cCzJDN`
- URL: `https://studio-os-cloud-site-15hxhnkga-whitephotostudio-7289s-projects.vercel.app`
- Primary alias: `https://www.studiooscloud.com`

Previous production rollback:

- Deployment: `dpl_6Rh2Z1JnspiFZytW26YezGvenryq`
- URL: `https://studio-os-cloud-site-ngi7mw6wx-whitephotostudio-7289s-projects.vercel.app`

## App rollback copies

Primary Stage A rollback:

`/Users/harout/StudioOS_Security_Backups/App_Rollbacks/Studio OS Stage-A Installed Original 2026-07-22 0840.app`

Additional verified copies:

`/Users/harout/StudioOS_Security_Backups/App_Rollbacks/Studio OS Pre-Secure-Digital-Delivery 2026-07-22 0840.app`

`/Users/harout/StudioOS_Security_Backups/App_Rollbacks/Studio OS Secure-Delivery Pre-Log-Hygiene 2026-07-22 0900.app`

Installed app:

`/Users/harout/Desktop/Studio OS.app`

## Rollback procedure

If the new Digital Orders workflow has a problem:

1. Quit Studio OS.
2. Preserve the current installed app instead of deleting it.
3. Restore the Primary Stage A rollback app above to `/Users/harout/Desktop/Studio OS.app`.
4. Promote the previous production deployment above if the website endpoint itself must also be rolled back.
5. Re-open Studio OS and verify the schedule and order counts before using Digital Orders.

## Deliberate remaining compatibility control

Public R2 access remains enabled for legacy references. Do not disable it until the remaining historical references and every parent/gallery/download workflow pass the final private-bucket compatibility tests. Patch 4 ensures new Desktop delivery emails do not expose permanent public URLs, but it does not itself make the bucket private.
