# Country-specific lab fulfillment foundation

Studio OS should keep one photographer workflow while the available options come from the selected country and lab. A country does not, by itself, prove a lab's product availability, currency, shipping coverage or crop/colour services.

The pure planning contract in `lib/labs/fulfillment-profile.ts` is now connected to the photographer's **Labs & price sheets** directory. A separate, append-only country-profile registry supplies the screen through the authenticated workspace GET. There is no new live order route, provider connection or printing permission. The existing three-print pilot, sheet drafts and Windows rehearsal helper retain their current contracts.

Country, city and lab are explicit choices. Changing a parent choice clears its dependent choices and hides the previous lab's options. There is no implicit first-lab fallback. The directory shows the exact selected profile's currency, products/costs, dimensions, finishes, paper, input modes, crop/colour services and delivery choices. A country's listing is distinct from shipping coverage.

Browsing is read-only and remains separate from the saved price-sheet editor. Existing sheets keep their original lab, currency and contents. New drafts created from the directory are bound on the server to the chosen lab/market/revision and permitted catalog IDs; their creation context cannot be changed or removed on save. Duplicating a sheet retains its context. Choosing another market requires a separate sheet.

An unconfigured domestic listing, including GTA Imaging, can expose its existing active catalog as an explicitly unverified reference. It does not infer paper, crop/colour or delivery services. A pending foreign-market profile cannot borrow the domestic catalog. Reference-only draft creation requires explicit acknowledgment and a bounded reference catalog; services and ordering remain unconfirmed.

## The selection rule

```text
Selected country → listed city / lab → that lab's approved country profile
                                      ├─ exact products and SKUs
                                      ├─ currency and available services
                                      ├─ delivery choices and destinations
                                      └─ accepted files and paper specifications
```

Keep three locations separate:

- **Selected market country:** the country-specific offering being considered.
- **Physical lab location:** its country, city and time zone.
- **Delivery country:** where an order will be collected or shipped. Shipping across a border requires explicit coverage; it is not inferred from either of the other countries.

The profile identity is the lab ID, market country and revision. A planning request must name that exact identity. The same lab can later have separate reviewed offerings for different markets. Never infer currency, tax, price, product equivalence or services from a country name.

## Finished products and paper are different

Each ordered line retains its own line ID, catalog product ID, exact case-sensitive SKU, finished dimensions, source asset ID and quantity. Dimensions explicitly use inches or millimetres. Equivalent physical dimensions may match across units; a nearby metric size must not silently replace an inch size. A product's `printsPerUnit` remains the count of physical print pieces in one priced catalog unit, not a printer packing instruction. Plan quantities explicitly count physical pieces.

Paper and positioned cells are declared separately. A plan must conserve every ordered piece, match each cell to its own line and source, fit the declared paper, avoid overlapping cells and use the paper's exact DPI and colour space. No automatic crop, resize, paper substitution or product substitution occurs in this planner.

For example, two independently reviewed 5×7 prints can be proposed as two individual files for one lab, or as two cells on one 10×7 paper for a lab that explicitly accepts composite sheets. This does not assert either format is approved by GTA Imaging or Prodigi. Real providers still need their own verified catalog and handoff agreement.

## Planning is separate from permission to produce

Unknown capabilities and malformed profiles cannot yield a compatible plan. Lab cropping, lab colour correction, pickup, shipment and destination coverage must be explicitly declared. The request currency must match the profile; this layer performs no currency conversion or payment calculation.

Only manual-download planning is supported by the new contract. API, hot-folder and Windows-helper transports remain unavailable through this planner even if a supplied document calls them configured. The existing fixed-format Windows rehearsal remains independent. An integration needs implemented server code and verified credentials before it can become an operational transport; a profile must never supply an arbitrary executable, endpoint, filesystem path or credential.

Every result remains a rehearsal: `testOnly:true`, `printAllowed:false` and `operationallyAuthorized:false`. A compatible plan proves only that its declared specifications match. It does not prove that private assets are owned, images are reviewed, files have been rendered, the lab has accepted an order, payment succeeded, a printer received files or physical printing occurred. Keep the existing account/MFA checks, immutable asset hashes, crop/colour reviews, receiver acceptance, idempotency and sealed handoff checks at their operational boundaries.

## Registry and rollout boundaries

Migration `20261016090000_lab_country_profiles.sql` adds a service-only registry, a latest-revision view and an administrator-only append RPC. It seeds no profiles and changes no existing rows. Approved documents are revalidated against the current exact lab, market, SKU, dimensions, currency and verified single-print catalog units before the screen exposes configured options. A later pending or invalid revision holds the profile instead of reviving an old approval.

The loader reads current revisions in bounded pages, with a 500-profile / 500 KB ceiling. Missing schema, unavailable reads or capacity exhaustion leave new options pending and keep the existing price workspace available. Worldwide production scale still requires filtered directory/catalog queries and lazy profile detail loading; this pilot does not claim unlimited global search capacity.

## Extending the operational workflow safely

1. Add a lab-owner proposal/review interface when onboarding real labs. Registry approval is currently a trusted operations action; the photographer's directory cannot upload a profile, approve a catalog or enable a lab.
2. Scope and paginate directory/catalog queries before worldwide volume. Retain exact server resolution of the selected country and lab; do not infer a currency or service from country alone.
3. Create a new versioned order snapshot containing the chosen profile revision, exact per-product SKU/specification, prices/currency, services and delivery selection. Preserve old order versions. The current fixed three-print production pilot is not a universal package engine and is not rewritten by this addition.
4. Run compatibility checks again on the server against the exact saved revision and current operational holds. Adding a revised catalog/profile must never change an already approved order or reinterpret its files.
5. Introduce one transport at a time, with idempotent submission, provider status reconciliation, explicit ambiguous-outcome handling and separate shipments/tracking when needed. A staged download or provider acceptance must never be labeled physically printed.
6. Verify each real lab's exact products, packaging, colour handling, delivery, currencies, billing and test output before enabling its intake. Country-specific tax, payment availability, retention/residency and commercial agreements require separate implementation and review; this contract does not activate the deferred international payment work.

Current schools, original price profiles, retail copies, existing catalog rows and historical production jobs are outside this change. Real GTA order intake, payments and physical printing stay disabled.

## Verification

`node --test tests/lab-fulfillment-profile.test.mjs` exercises fictional Canadian, British and Japanese profiles; separate and combined paper; exact cross-unit matching; an eight-line mixed-size order; source/quantity conservation; unsupported options; stale/foreign profile rejection; and immutable, non-operational test snapshots. These are offline compatibility tests, not tests of real labs or international payment availability.

The screen-integration tests additionally cover registry immutability/permissions, exact catalog projection, current revisions, read-only GET, dependent selectors and frozen new-draft context. Existing school prices, old sheets, production renderers, payment routes and applied migrations are not rewritten by the integration.
