# Lab receiving and direct production orders

Studio OS now has a separate lab receiving portal at `/lab` and a photographer production workspace at `/dashboard/labs/orders`. These are additive to the existing school/event checkout and in-house printing workflow. The old price sheet page remains `/dashboard/packages`, displayed under **Personal → In-house / Self-fulfillment**. Relabeling the navigation does not copy, convert, reassign or delete a price list.

## What a lab receives

A photographer chooses a production-ready lab and an approved catalog SKU, uploads a finished JPEG/PNG for each line, enters quantities, and chooses pickup or shipment to the studio. The photographer explicitly reviews the files and acknowledges separate lab billing before submission. This is a direct studio-to-lab order, not an automatic conversion of a parent/customer order.

Each accepted submission freezes product names, SKUs, dimensions, confirmed wholesale costs, quantities, delivery instructions, private file keys, byte sizes and SHA-256 hashes. Future catalog or price-sheet edits cannot rewrite that submitted order. The database computes costs; the browser cannot supply a price, file key, owner or status.

Files are private, immutable uploads in `lab-production-files`; there is no public photo URL. Uploads are limited to 4 MB per JPEG/PNG, a single image, 100 megapixels, and 50 order lines with at most 100 copies per line. Files must already be cropped to the selected print shape within 2% (portrait/landscape allowed). Images are decoded before becoming ready. EXIF transforms must be baked into an upright export; Studio OS does not silently re-encode or crop a production original. Colour, effective resolution and physical print output still require lab review.

## Order workflow

| Current stage | Allowed next stage | Who acts |
| --- | --- | --- |
| Submitted | Accepted or declined with a reason | Lab owner/operator |
| Submitted | Cancelled | Sending studio |
| Accepted | In production | Lab owner/operator |
| In production | Ready | Lab owner/operator |
| Ready, pickup | Completed | Lab owner/operator |
| Ready, shipment | Shipped, with carrier and tracking | Lab owner/operator |
| Shipped | Completed | Lab owner/operator |

Viewer members can read/download their lab's submitted jobs but cannot change them. A lab account needs enrolled MFA and a provisioned active membership; platform administration alone grants no lab-file access. Lab memberships still use trusted provisioning. After acceptance, the studio contacts the lab about changes or cancellation; no unimplemented refund/reprint action is presented as completed.

Every transition has a compare-and-swap version check and a durable audit event. Exact retries reuse the same request ID and return the existing receipt; changed payloads cannot reuse that ID. Invalid transitions, foreign accounts/labs, stale tabs and unauthorized writes fail before changing state. Pausing intake prevents new submissions while allowing authorized staff to finish existing jobs.

## Preservation and release boundaries

`20261015220000_lab_orders.sql` creates only new lab tables, policies/functions/indexes and the new private bucket. It does not write existing schools, projects, gallery assignments, packages, price sheets, customer orders, payments or desktop data. SQL and actual Next HTTP integration tests compare representative existing records byte-for-byte before/after migration and the complete production workflow.

GTA remains in setup with unverified reference catalog costs. No real GTA order is sent, live customer checkout enabled, fee collected, provider changed, or production deployment/migration applied by this implementation. Existing customer-checkout holds on lab products remain. Real GTA catalog confirmation, membership onboarding, hosted storage/RLS rehearsal and a physical sample order are required before its intake is enabled.

An isolated hosted pilot needs separate Supabase Auth, database and private storage. For the dedicated `lgwmxqjwgkzktikhkebp` pilot, set `STUDIO_OS_LAB_PILOT=1` and `RATE_LIMIT_KEY_PREFIX=lab-pilot-20261015`, alongside that project's Supabase URL, anon key and service-role key. After checking the actual project identity, prepend `SET studio_os.lab_pilot_project_ref='lgwmxqjwgkzktikhkebp';` to [lab-pilot-rate-limit.sql](../scripts/lab-pilot-rate-limit.sql) and apply it only there after the lab schema. The script requires this target attestation and lab schema, uses bounded lock/statement timeouts, and is deliberately outside production migrations. The general API limiter then uses an atomic service-only database RPC, hashes counter identities, times out after five seconds, and never falls back to Redis or memory. The exact HTTPS pilot URL and a prefix containing 1–64 ASCII letters, digits, underscores or hyphens are required; invalid configuration denies requests. Protected routes stay closed on counter outages; existing availability-oriented callers retain their outage policy. No Redis, financial, email or R2 credentials are needed for this lab rehearsal. The dedicated Redis PIN reservation flow remains outside the database-only lab pilot.

The longer-term product can share an order engine between **Personal / In-house** and **Partner labs**. A photographer's own lab should remain private unless they choose to list it as a public partner. The current in-house data and screens remain in use. Retiring that interface requires functional parity, a reviewed migration/reconciliation and explicit release approval; it is not part of this additive change.

## Routes and testing

- `/api/dashboard/lab-orders`: studio list, submission and cancellation.
- `/api/dashboard/lab-order-assets`: authenticated bounded multipart production-file upload.
- `/api/lab/orders`: lab-scoped receiving queue and role-checked status updates.
- `/api/lab/orders/[id]/files/[assetId]`: authenticated exact-file download; studios use `?audience=studio`. Downloads recheck the frozen byte size/hash.
- Lists use stable cursor pagination (100 jobs/page), with a lab-scoped query for the receiving portal.

```sh
node scripts/lab-system-fixture.mjs --app --app-port=55492
LAB_SYSTEM_HTTP_ORIGIN=http://localhost:55492 node --test tests/lab-orders-flow.test.mjs tests/lab-catalog-flow.test.mjs tests/lab-system-flow.test.mjs
npm test
npx tsc --noEmit
npm run build
```

The loopback fixture has synthetic accounts only. Photographer: `owner@lab.example.test`. Lab roles: `labowner@lab.example.test`, `operator@lab.example.test`, `viewer@lab.example.test`, `foreignlab@lab.example.test`. All use `LocalLabOnly123!`. Lab identities have synthetic completed MFA; this does not bypass real account enrollment. The fixture validates application/SQL behavior, not real provider storage, physical printing or actual payments.
