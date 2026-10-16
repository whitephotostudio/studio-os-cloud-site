# Private in-house price copies

The **Your studio prices** section at `/dashboard/labs` lets a photographer review and edit a private test copy of an existing studio retail price profile. Copies contain individual sizes, packages and specialty products, including explicitly recorded digital options and wallet settings. The source price profile, school assignments, existing customer orders and connected lab catalogs are unchanged.

## Storage and access

`20261016030000_in_house_price_sheets.sql` adds `in_house_price_sheets`, an owner index, an owner-read RLS policy and the service-only `save_in_house_price_sheet` function. It does not update existing school, profile, package, order or catalog tables. Authenticated users can read only their own copies; ordinary clients and the service role cannot write directly to the table. The server derives the photographer from the verified account before calling the mutation function.

`/api/dashboard/in-house-price-sheets` uses the existing dashboard origin, authentication, MFA and rate-limit checks. Responses use `Cache-Control: private, no-store`. The isolated pilot permits this exact API path without opening existing school, customer pricing or payment routes.

- `GET` returns `{ ok, sheets }` for the signed-in photographer.
- `POST` with `action: "import"` accepts an `InHousePriceSheetImport` document and returns `{ ok, sheet, sheets, replayed }`.
- `POST` with `action: "save"` accepts the copy ID, expected version, name and all entry IDs with their retail amounts and active flags.

Contracts are defined in `lib/labs/in-house-types.ts` and validated by `lib/labs/in-house-validation.ts`. Imports are bounded to 2 MB, 1,000 entries and 200 stored copies per photographer. Retail amounts use exact integer currency minor units; the `retailCents` field also supports zero- and three-digit currencies without conversion. Opaque source settings must be bounded JSON.

## Source preservation and safe retries

Importers provide the original `sourceSnapshot` and its SHA-256 hash. Use `inHouseSourceHash` to hash the canonical JSON representation: object keys are sorted recursively, while array ordering and saved values remain significant. The API recomputes the hash and rejects a mismatch.

The unique import key is the photographer, source profile identifier and source content hash. An owner-level transaction lock serializes imports and allocation checks. Retrying the same source returns the existing copy with `replayed: true`, including any subsequent edits to that copy. A retry never resets prices or creates another copy. Reusing the same source identity/hash with a different snapshot is rejected. A genuinely changed source uses a new verified hash and creates a separate draft.

Import preparation must preserve duplicate source rows with distinct stable entry IDs and source keys. Keep any name-versus-recorded-quantity discrepancy as supplied and add a source warning rather than silently correcting quantities. Do not infer a wallet layout, print count or digital entitlement from a product name.

## Editing a copy

Save requests require every existing entry ID exactly once. The SQL function locks the copy and checks `expectedVersion` before changing anything. A successful save increments the version and changes only:

- The copied price-sheet name.
- Each entry's `retailCents`.
- Each entry's `active` flag.

Original names, entry ordering, contents, options, source snapshot/hash, studio identity, currency, warnings and tax settings stay frozen. Source tax settings are displayed for reference; this preview does not calculate or collect tax. Stale saves return HTTP `409` with `IN_HOUSE_VERSION_CONFLICT`; the editor retains unsaved input and offers an explicit discard-and-reload action.

Every copy remains `status: "draft"` and `fulfillment: "in_house"`. The copy editor has no assignment, publication, customer checkout or external order-routing action. An explicitly selected active print package can be frozen into a separate, private, no-payment test gallery in the isolated pilot; see [Private in-house order rehearsal](./in-house-test-orders.md). Creating that test gallery does not publish or reassign the copy. Copied retail prices are not wholesale catalog costs, and no lab SKU, cost, markup, profit or production mapping is inferred. The separate partner-lab sample workflow continues to use its approved synthetic catalog.

## Additive rollout and verification

`loadLabWorkspace` includes the owner's copies as optional `inHousePriceSheets`. During an additive rollout, a specifically missing new table (`42P01` or the matching `PGRST205` schema-cache error) becomes an empty list for the existing workspace only. Other database errors remain visible. The dedicated private-copy API fails visibly if its storage is unavailable; it never reports an unsaved copy as saved.

Run the focused synthetic checks with:

```sh
node --test tests/in-house-price-sheets.test.mjs tests/in-house-price-sheets-ui.test.mjs tests/security/lab-pilot-guard.test.mjs
```

The optional actual-Next test in `tests/in-house-price-sheets.test.mjs` additionally uses `LAB_SYSTEM_HTTP_ORIGIN` with the loopback fixture described in [lab-system.md](./lab-system.md). Checks cover exact source preservation, owner isolation, denied direct writes, import retries, stale and foreign saves, immutable contents, currency-aware edits and existing-data canaries. Keep private studio prices, source profile identifiers and customer data out of repository fixtures and documentation.
