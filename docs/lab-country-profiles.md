# Country and lab profile registry

The lab directory now reads country-specific planning profiles. Choosing a market country, physical lab city and lab does not change an open price sheet. A configured profile describes a reviewed test-planning contract; it never enables checkout, real GTA intake, payment or printing.

`lab_country_profiles` is a new append-only registry keyed by lab ID, market country and revision. `lab_country_profile_latest` returns only the newest revision for each pair. A new pending revision shadows an older approved revision. Historical rows cannot be updated or deleted, including by the application service role. No existing lab, catalog, school, price or order rows are backfilled.

The workspace adds `countryProfiles:{available,options}`. Every known lab retains a pending option for its physical country when no valid profile exists. That domestic option may show its active catalog in the lab's existing currency for reference, including unverified GTA reference products. A foreign pending profile never borrows the domestic catalog. Physical city and physical country remain separate from the selected market and allowed shipping destinations.

Before any option is shown as configured, the server validates the complete versioned document with `parseFulfillmentProfile` and checks the registry identity, physical city/country, exact lab currency, manual-download transport and every product's exact catalog ID, case-sensitive SKU, currency and physical dimensions. Each product must be active, verified, lab-confirmed, have a known integer cost and explicitly represent one physical print per priced unit. One mismatch holds the entire profile. Nearby metric and inch sizes are not substituted. A catalog that stores only an approximate inch conversion of a metric size stays pending until its physical specification can be represented and confirmed correctly.

## Loading a future profile

This release intentionally exposes no browser upload or approval route. Operations use the trusted server helper `appendLabCountryProfile` in `lib/labs/country-profiles.ts`. Do not write the registry table directly or copy a fictional provider configuration into production.

1. Obtain the actual lab's products, SKUs, exact dimensions, accepted files/papers, crop/colour services, delivery destinations and currency. Keep its intake disabled during setup.
2. Load a fresh authorized lab and catalog snapshot through the service client. Review the actual account's platform-administrator authorization; a lab owner cannot approve their own production profile through this registry RPC.
3. Prepare a strict `FulfillmentProfile` document for that lab, selected market and the next revision. `version` is currently 1; `revision` starts at 1 per lab/market pair and increases by exactly one. Do not infer services, currencies or delivery countries from location.
4. Call `appendLabCountryProfile(service, actorUserId, {labId,marketCountryCode,revision,status:'approved',document}, labs, catalog)` from trusted operations code. The helper applies the strict parser and full current-catalog validation before calling the service-only `put_lab_country_profile` RPC. The RPC independently requires a current platform administrator, checks the identity and revision, and records the reviewer. Exact retries return the existing revision; changed details conflict.
5. Reload the workspace and confirm that the exact country/lab option is configured and still explicitly test-only. Profile metadata does not replace asset ownership, review, lab acceptance, payment or dispatch authorization.
6. To withdraw or hold the offering, append the next revision with `status:'pending', document:null`. Do not modify an approved historical row. A replacement approved revision must go through the same review again.

The helper requires freshly loaded lab/catalog arrays and rechecks the projection on every workspace read. If the catalog changes after an operations review, the profile automatically becomes pending rather than inheriting stale approval. The stored document is limited to 64 KB. The current pilot reads at most 500 latest profiles and 500 KB total in pages of 25; capacity or schema failures yield pending options and preserve the existing price workspace. Before worldwide scale, replace this complete bounded payload with server-filtered country/lab lookup and scoped detail loading.

## New draft binding

New country-aware create requests supply `marketCountryCode`, `profileRevision` and `referenceOnly`. Configured requests must name the current exact approved revision; explicit reference requests use a null revision and can use only that option's displayed reference catalog. A pending option with no catalog cannot create a price sheet by borrowing another country's products.

The server records an optional `marketContext` in the new draft document, freezing market, revision/reference mode and permitted catalog IDs. Save cannot add, remove or switch that context; duplicate preserves it. The server checks every chosen item/package against the frozen IDs. Existing sheets have no context and keep their existing editor behavior. Browsing countries never rewrites an old sheet or silently changes its product list.

Country-aware creation uses the additive `create_country_lab_price_sheet` RPC. It takes the same lab/market advisory lock as profile revision changes, checks the latest approved revision and current exact catalog under shared locks, and only then delegates creation to the existing price-sheet RPC in the same transaction. A pending revision or changed catalog arriving between the workspace read and create request cannot silently create a draft under stale approval. The legacy RPC and old create/save/duplicate paths remain unchanged.

Reference context is capped at 500 product IDs. Larger catalogs need a scoped selection workflow before creating a country-bound draft; they are not silently truncated. Existing unbound reference sheets remain available. A new market using another currency within the same lab still needs a separate catalog/price-book implementation; this release does not perform FX or change the legacy one-currency-per-lab price-sheet contract.
