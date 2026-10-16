# Private in-house order rehearsal

This module rehearses one complete in-house workflow with a copied studio retail price sheet and fixed synthetic artwork. A photographer creates a private test gallery, opens its parent view, submits a sample package without payment, and receives it in the same studio's private queue. The studio advances the saved order through **Submitted → Accepted → In production → Ready → Completed**. The photographer tracking view and the parent's saved receipt read that same order history after refresh.

This is an explicitly gated lab pilot. Every new page and API handler checks `isLabPilot()`, which requires the existing pilot flag and its exact isolated Supabase project. The production gate has no synthetic-test exception. The existing school gallery, customer checkout, partner-lab ledger, original price profiles and school assignments are not connected to this rehearsal. GTA intake remains disabled. No email, payment, fee collection, tax calculation, shipping charge, external lab submission or printer action runs here.

## Offers and synthetic files

The initial eligible offer is an active copied **package** with exactly two recorded contents:

- One `8x10 Lustre` print.
- Two `5x7 Lustre` prints.

Contents must contain only the explicit `name` and integer `qty` keys. Extra options, ambiguous quantities, inactive entries, digital products, wallets and specialty services are not inferred into production. A positive integer retail amount is required. `retailCents` continues to mean integer currency minor units; it does not become a wholesale cost. There is no lab SKU or inferred internal cost.

The gallery creation RPC independently checks source ownership, the expected copied-sheet version and exact package eligibility. It freezes the chosen retail offer and source version in the new gallery. The copied sheet stays a draft and is not assigned or published. Later edits to the copied sheet affect neither an existing test gallery nor an order; create a new test gallery to rehearse a revised price.

Only the supplied synthetic artwork can be selected. Its two JPEG outputs have separate 8×10 and 5×7 shapes, filenames, pixel dimensions, byte sizes and SHA-256 hashes. `lib/labs/in-house-sample-assets.ts` verifies bytes against the fixed manifest. No upload, customer photo, arbitrary file path or browser-provided image metadata is accepted. Package quantity is limited to 1–10. Order snapshots multiply the two prepared file quantities by the package count, yielding three prints per package.

Owner downloads at `/api/dashboard/in-house-test-files` recheck ownership and every saved manifest field against the verified files. The download can return either exact JPEG or a JSON sample production manifest. The manifest includes package quantity, print quantities, test subtotal and an explicit synthetic-only notice. Downloading a file does not print it.

## Access and private links

`/dashboard/labs/in-house` contains **Test galleries**, **Receiving queue** and **Photographer tracking**. It uses the existing verified photographer auth, MFA rules, same-origin protection and fail-closed rate limiting. It does not grant partner-lab operators access to private studio orders. The old pricing screens and existing partner receiving portal remain separate.

The owner browser generates a cryptographically random gallery token before creation and retains the exact pending request in owner-scoped session storage. A parent link places that token in the URL fragment, not its path or query. The browser sends it in a bounded JSON POST body; the server stores only SHA-256 token hashes. The parent page does not server-render private prices.

Gallery links expire after seven days. **Generate new link** rotates the token and invalidates the old link; **Close gallery** revokes new gallery reads and submissions. An owner can retry the same rotation or revocation after an uncertain response without accidentally replacing the result. Browser session storage retains private links for that account and tab session; reopening a workspace without the link requires an explicit new link.

The parent generates a separate receipt token before submitting. Its saved request is retained until the server confirms an order. Retrying the same request confirms the same order; a changed payload cannot reuse its request ID. The receipt token opens only that order for up to thirty days, independent of gallery rotation, closure or expiry. The receipt stays in the parent tab's session storage so a reload can recover a confirmed or uncertain submission. No parent identity, address or payment information is collected.

Parent responses contain only the selected public offer, studio display name, synthetic files and its own receipt/history. Public offer identifiers are generated independently from private copied-entry IDs. Owner IDs, source profile IDs, source snapshots, warnings, inactive offers and token hashes are excluded. API responses use private no-store caching, no-referrer and noindex headers. The public sample preview reveals only supplied synthetic artwork.

## Database and HTTP contracts

`20261016040000_in_house_test_order_loop.sql` creates three new tables:

- `in_house_test_galleries`: owner-scoped gallery offer/source snapshots and hashed gallery access.
- `in_house_test_orders`: immutable order snapshot, hashed receipt access and versioned status.
- `in_house_test_order_events`: append-only submitted/production history.

Authenticated direct reads use owner RLS. Ordinary clients and the service role have no direct write grants. Service-only security-definer RPCs derive or check the verified owner, enforce capacity, lock rows/requests and perform mutations atomically. Gallery allocation is limited to thirty per owner and orders to twenty per gallery. Source/offer snapshots and order snapshots cannot be rewritten; events cannot be edited or deleted.

The dashboard endpoint `/api/dashboard/in-house-test-orders` supports:

- `GET`: `{ ok, workspace: { sheets, galleries, orders } }`, with eligible sheet choices only.
- `create_gallery`: request ID, copied sheet ID, expected sheet version, entry ID, name and gallery token.
- `rotate_gallery` or `revoke_gallery`: gallery ID and expected version, plus a new token for rotation.
- `transition`: order ID, expected version, request ID and next production status.

The parent endpoint `/api/labs-pilot/in-house` accepts only POST actions:

- `gallery`: gallery ID and gallery token.
- `submit`: gallery ID/token, request ID, receipt token, public offer ID, the fixed sample-photo ID and package quantity.
- `receipt`: receipt token only.

Strict schemas reject client prices, totals, ownership, source snapshots, file paths, tax settings, statuses and extra fields. Database code derives frozen prices, totals and multiplied file quantities. Conflicting requests or stale versions return HTTP `409`; inaccessible or expired capabilities return `404`. Provider details and secret inputs are not echoed in errors. Unknown infrastructure failures return `503` without inventing a saved receipt.

## Verification and synthetic HTTP mode

Focused tests use synthetic studio data and actual PostgreSQL-compatible SQL through PGlite:

```sh
node --test tests/in-house-test-orders.test.mjs tests/in-house-test-ui.test.mjs
```

The optional actual-Next HTTP mode keeps the application pilot guard intact while replacing server provider fetches with the loopback synthetic provider:

```sh
node scripts/lab-system-fixture.mjs --app --pilot-http --port=55495 --app-port=55496
LAB_SYSTEM_HTTP_ORIGIN=http://localhost:55496 LAB_SYSTEM_FIXTURE_URL=http://127.0.0.1:55495 node --test tests/in-house-test-orders.test.mjs
```

Use only a clean worktree without environment files. The fixture starts Next with a minimal environment and synthetic auth keys, installs the real pilot database rate-limit function into PGlite, and loads `scripts/lab-pilot-fixture-fetch.cjs` only through that child process's `NODE_OPTIONS`. The preload requires explicit local fixture configuration and refuses production mode. It rewrites only the exact pilot-provider origin to loopback and rejects external provider fetches. It does not add an application bypass or contact the real pilot provider. This mode is for HTTP integration with fixture Bearer tokens; do not use browser sign-in, whose client-side provider configuration is intentionally not intercepted.

Checks cover exact old-table preservation, owner/foreign/lab isolation, denied direct writes and anonymous RPCs, offer eligibility, forged pricing/files, capability expiry/rotation/revocation, request replay/conflicts, stale transitions, immutable snapshots after price edits, independent receipt tracking and exact downloaded file hashes/quantities. Hosted pilot browser verification remains separate from synthetic HTTP tests. Neither proves real payments, external fulfillment, colour handling or physical printing.
